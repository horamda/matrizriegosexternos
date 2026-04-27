"""
Dashboard de riesgos operativos con Flask, Pandas y Chart.js.
"""

from __future__ import annotations

import json
import os
import re
import unicodedata
from datetime import datetime, timedelta, timezone
from io import StringIO
from typing import Any

import pandas as pd
import requests
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

DATA_SOURCE = os.environ.get("DATA_SOURCE", "csv_url").strip().lower()
GOOGLE_SHEETS_CSV_URL = os.environ.get(
    "GOOGLE_SHEETS_URL",
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vQwYGuq7x5NqIHzyUjcx5fOSPBNgZCewAd7cR5r7x5wRlTKK0fhWUwZLHwx3L3Uxn1uLIFePDf8fLxe/pub?gid=0&single=true&output=csv",
)
LOCAL_CSV_PATH = os.environ.get("LOCAL_CSV_PATH", "").strip()
MYSQL_EVENTS_QUERY = os.environ.get(
    "MYSQL_EVENTS_QUERY",
    "SELECT fecha, evento, tipo_riesgo, impacto, probabilidad, plan_accion, "
    "impacto_financiero FROM eventos_operativos",
)
CACHE_TTL_SECONDS = int(os.environ.get("DATA_CACHE_TTL", "300"))
REQUEST_TIMEOUT_SECONDS = int(os.environ.get("DATA_REQUEST_TIMEOUT", "20"))
DASHBOARD_CURRENCY = os.environ.get("DASHBOARD_CURRENCY", "ARS").strip().upper()
DASHBOARD_LOCALE = os.environ.get("DASHBOARD_LOCALE", "es-AR").strip()

MONTH_ABBR = {
    1: "Ene",
    2: "Feb",
    3: "Mar",
    4: "Abr",
    5: "May",
    6: "Jun",
    7: "Jul",
    8: "Ago",
    9: "Sep",
    10: "Oct",
    11: "Nov",
    12: "Dic",
}

SEVERITY_TOKENS = {
    "muy bajo",
    "bajo",
    "medio",
    "moderado",
    "alto",
    "muy alto",
    "mayor",
    "critico",
    "critical",
}

EXPECTED_COLUMNS = [
    "fecha",
    "evento",
    "tipo_evento",
    "tipo_riesgo",
    "impacto_cualitativo",
    "probabilidad",
    "plan_accion",
    "accion_status",
    "impacto_financiero",
    "mes",
    "mes_label",
    "anio",
    "categoria_impacto",
    "impacto_score",
    "probabilidad_score",
    "nivel_riesgo",
    "riesgo_score",
]

COLUMN_ALIASES = {
    "fecha": {
        "fecha",
        "date",
        "fecha_registro",
        "fecha_evento",
        "fecha_creacion",
        "event_date",
        "occurrence_date",
    },
    "evento": {
        "evento",
        "event",
        "descripcion",
        "description",
        "detalle_evento",
        "nombre_evento",
        "incident",
    },
    "tipo_evento": {
        "tipo_evento",
        "tipo_de_evento",
        "event_type",
        "clase_evento",
        "categoria_evento",
        "proceso",
        "proceso_afectado",
        "subtipo_evento",
    },
    "tipo_riesgo": {
        "tipo_riesgo",
        "tipo_de_riesgo",
        "risk_type",
        "categoria_riesgo",
        "family_risk",
        "riesgo",
        "tipo",
        "categoria",
    },
    "impacto_cualitativo": {
        "impacto",
        "impacto_cualitativo",
        "impacto_dano",
        "qualitative_impact",
        "severidad",
        "severity",
        "nivel_impacto",
    },
    "probabilidad": {
        "probabilidad",
        "probability",
        "likelihood",
        "frecuencia",
        "frecuencia_ocurrencia",
        "prob",
    },
    "plan_accion": {
        "plan_accion",
        "plan_de_accion",
        "action_plan",
        "mitigacion",
        "controles",
        "accion",
        "owner_action_plan",
    },
    "impacto_financiero": {
        "impacto_financiero",
        "impacto_financiero_valor_aproximado",
        "financial_impact",
        "monto",
        "importe",
        "amount",
        "costo",
        "coste",
        "loss_amount",
        "perdida",
        "impacto_economico",
        "valor",
    },
}

IMPACT_SCORE_MAP = {
    "muy bajo": 1,
    "bajo": 2,
    "media baja": 2,
    "medio": 3,
    "moderado": 3,
    "media": 3,
    "alto": 4,
    "alta": 4,
    "muy alto": 5,
    "mayor": 5,
    "critico": 5,
    "critical": 5,
    "high": 4,
    "medium": 3,
    "low": 2,
}

PROBABILITY_SCORE_MAP = {
    "muy baja": 1,
    "rara": 1,
    "raro": 1,
    "improbable": 1,
    "baja": 2,
    "ocasional": 2,
    "posible": 3,
    "media": 3,
    "moderada": 3,
    "probable": 4,
    "alta": 4,
    "frecuente": 4,
    "muy alta": 5,
    "casi seguro": 5,
    "casi segura": 5,
    "seguro": 5,
    "certain": 5,
    "low": 2,
    "medium": 3,
    "high": 4,
}

_cache: dict[str, Any] = {"df": None, "loaded_at": None}


def normalize_token(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = text.encode("ascii", "ignore").decode("ascii")
    text = re.sub(r"[^a-zA-Z0-9]+", "_", text.lower()).strip("_")
    return text


def normalize_text(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = text.encode("ascii", "ignore").decode("ascii")
    text = re.sub(r"\s+", " ", text).strip().lower()
    return text


def empty_dataframe() -> pd.DataFrame:
    return pd.DataFrame(columns=EXPECTED_COLUMNS)


def parse_financial_value(value: Any) -> float:
    if pd.isna(value):
        return 0.0
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)

    text = str(value).strip()
    if not text:
        return 0.0

    text = text.replace("\xa0", "").replace(" ", "")
    text = re.sub(r"[^\d,.\-]", "", text)

    if text in {"", "-", ".", ","}:
        return 0.0

    if "," in text and "." in text:
        if text.rfind(",") > text.rfind("."):
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", "")
    elif "," in text:
        head, tail = text.rsplit(",", 1)
        if len(tail) <= 2:
            text = f"{head.replace(',', '')}.{tail}"
        else:
            text = text.replace(",", "")
    elif "." in text:
        head, tail = text.rsplit(".", 1)
        if len(tail) == 3 and head.replace(".", "").replace("-", "").isdigit():
            text = text.replace(".", "")
    elif text.count(".") > 1:
        head, tail = text.rsplit(".", 1)
        if len(tail) <= 2:
            text = f"{head.replace('.', '')}.{tail}"
        else:
            text = text.replace(".", "")

    try:
        return float(text)
    except ValueError:
        return 0.0


def parse_scale_value(value: Any, mapping: dict[str, int], fallback: int = 3) -> int:
    if pd.isna(value):
        return fallback

    if isinstance(value, (int, float)) and not isinstance(value, bool):
        numeric = round(float(value))
        return int(min(max(numeric, 1), 5))

    text = normalize_text(value)
    if not text:
        return fallback

    number_match = re.search(r"\d+(\.\d+)?", text)
    if number_match:
        numeric = round(float(number_match.group(0)))
        if numeric > 5 and numeric <= 100:
            if numeric <= 20:
                return 1
            if numeric <= 40:
                return 2
            if numeric <= 60:
                return 3
            if numeric <= 80:
                return 4
            return 5
        return int(min(max(numeric, 1), 5))

    return mapping.get(text, fallback)


def impact_category_from_score(score: int) -> str:
    if score >= 4:
        return "alto"
    if score == 3:
        return "medio"
    return "bajo"


def risk_level_from_score(score: int) -> str:
    if score >= 12:
        return "alto"
    if score >= 6:
        return "medio"
    return "bajo"


def classify_action_record(value: Any) -> str:
    return "accion_realizada"


def month_label_from_timestamp(value: pd.Timestamp) -> str:
    return f"{MONTH_ABBR.get(value.month, value.month)} {value.year}"


def fix_mojibake(value: Any) -> Any:
    if pd.isna(value):
        return value

    text = str(value)
    if not any(marker in text for marker in ("Ã", "Â", "â")):
        return text

    try:
        return text.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return text


def infer_risk_family(event_name: Any) -> str:
    text = normalize_text(event_name)
    if not text:
        return "Sin clasificar"

    rules = [
        ("Laboral", ("sindical", "asamblea", "paro")),
        ("Sanitario", ("plaga",)),
        ("Seguridad fisica", ("robo", "violencia", "vecinal")),
        ("Climatico", ("inund", "temporal")),
        ("Infraestructura", ("luz", "generador", "energia", "electrico")),
        ("Tecnologico", ("cibern", "internet", "sistema", "phishing", "sextorsion")),
        ("Logistico", ("ruta", "camion", "entrega")),
    ]

    for family, keywords in rules:
        if any(keyword in text for keyword in keywords):
            return family

    return "Operacional"


def risk_type_is_severity(series: pd.Series) -> bool:
    values = {
        normalize_text(value)
        for value in series.dropna().astype(str)
        if normalize_text(value)
    }
    return bool(values) and values.issubset(SEVERITY_TOKENS)


def decode_csv_content(response: requests.Response) -> str:
    encodings = [response.encoding, "utf-8", response.apparent_encoding, "latin-1"]
    tried: set[str] = set()

    for encoding in encodings:
        if not encoding:
            continue
        normalized = encoding.lower()
        if normalized in tried:
            continue
        tried.add(normalized)
        try:
            decoded = response.content.decode(encoding)
            if "\ufffd" not in decoded:
                return decoded
        except (LookupError, UnicodeDecodeError):
            continue

    return response.content.decode("utf-8", errors="replace")


def records_from_frame(frame: pd.DataFrame) -> list[dict[str, Any]]:
    if frame.empty:
        return []
    return json.loads(frame.to_json(orient="records", date_format="iso"))


def load_mysql_dataframe() -> pd.DataFrame:
    database_url = os.environ.get("DATABASE_URL", "").strip()
    if not database_url:
        raise RuntimeError(
            "DATABASE_URL es obligatorio cuando DATA_SOURCE=mysql."
        )

    try:
        from sqlalchemy import create_engine
    except ImportError as exc:
        raise RuntimeError(
            "Instala SQLAlchemy y el driver de MySQL para usar DATA_SOURCE=mysql."
        ) from exc

    engine = create_engine(database_url, pool_pre_ping=True)
    return pd.read_sql_query(MYSQL_EVENTS_QUERY, engine)


def read_source_dataframe() -> pd.DataFrame:
    if DATA_SOURCE == "local_csv":
        if not LOCAL_CSV_PATH:
            raise RuntimeError("LOCAL_CSV_PATH no esta configurado.")
        return pd.read_csv(LOCAL_CSV_PATH)

    if DATA_SOURCE == "mysql":
        return load_mysql_dataframe()

    response = requests.get(GOOGLE_SHEETS_CSV_URL, timeout=REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()
    return pd.read_csv(StringIO(decode_csv_content(response)))


def rename_columns(frame: pd.DataFrame) -> pd.DataFrame:
    normalized_columns = {column: normalize_token(column) for column in frame.columns}
    frame = frame.rename(columns=normalized_columns)

    reverse_alias_map: dict[str, str] = {}
    for canonical, aliases in COLUMN_ALIASES.items():
        for alias in aliases:
            reverse_alias_map[normalize_token(alias)] = canonical

    rename_map: dict[str, str] = {}
    for column in frame.columns:
        canonical = reverse_alias_map.get(column)
        if canonical and canonical not in rename_map.values():
            rename_map[column] = canonical

    return frame.rename(columns=rename_map)


def preprocess_dataframe(raw_frame: pd.DataFrame) -> pd.DataFrame:
    if raw_frame is None or raw_frame.empty:
        return empty_dataframe()

    df = rename_columns(raw_frame.copy())

    for column in [
        "fecha",
        "evento",
        "tipo_evento",
        "tipo_riesgo",
        "impacto_cualitativo",
        "probabilidad",
        "plan_accion",
        "impacto_financiero",
    ]:
        if column not in df.columns:
            df[column] = pd.NA

    df["fecha"] = pd.to_datetime(df["fecha"], errors="coerce", dayfirst=True)

    for column in ["evento", "tipo_evento", "tipo_riesgo", "impacto_cualitativo", "probabilidad", "plan_accion"]:
        df[column] = df[column].astype("string").map(fix_mojibake).astype("string").str.strip()

    df["evento"] = df["evento"].replace({"": pd.NA, "nan": pd.NA, "None": pd.NA})
    df = df[df["evento"].notna()].copy()

    df["tipo_evento"] = df["tipo_evento"].replace({"": pd.NA, "nan": pd.NA})
    df["tipo_evento"] = df["tipo_evento"].fillna(df["evento"])

    df["tipo_riesgo"] = df["tipo_riesgo"].replace({"": pd.NA, "nan": pd.NA}).fillna("Sin clasificar")
    df["plan_accion"] = df["plan_accion"].replace({"": pd.NA, "nan": pd.NA}).fillna("Accion realizada")
    df["accion_status"] = df["plan_accion"].apply(classify_action_record)
    df["impacto_cualitativo"] = (
        df["impacto_cualitativo"].replace({"": pd.NA, "nan": pd.NA}).fillna("medio")
    )
    df["probabilidad"] = df["probabilidad"].replace({"": pd.NA, "nan": pd.NA}).fillna("media")
    df["impacto_financiero"] = df["impacto_financiero"].apply(parse_financial_value)

    df["impacto_score"] = df["impacto_cualitativo"].apply(
        lambda value: parse_scale_value(value, IMPACT_SCORE_MAP, fallback=3)
    )
    df["probabilidad_score"] = df["probabilidad"].apply(
        lambda value: parse_scale_value(value, PROBABILITY_SCORE_MAP, fallback=3)
    )

    if risk_type_is_severity(df["tipo_riesgo"]):
        df["tipo_riesgo"] = df["evento"].apply(infer_risk_family)

    df["categoria_impacto"] = df["impacto_score"].apply(impact_category_from_score)
    df["riesgo_score"] = df["impacto_score"] * df["probabilidad_score"]
    df["nivel_riesgo"] = df["riesgo_score"].apply(risk_level_from_score)

    month_period = df["fecha"].dt.to_period("M")
    month_start = month_period.dt.to_timestamp()
    df["mes"] = month_start.dt.strftime("%Y-%m")
    df.loc[df["fecha"].isna(), "mes"] = pd.NA
    df["mes_label"] = month_start.apply(
        lambda value: month_label_from_timestamp(value) if pd.notna(value) else pd.NA
    )
    df["anio"] = df["fecha"].dt.year.astype("Int64")

    return df[EXPECTED_COLUMNS].sort_values("fecha", ascending=False, na_position="last").reset_index(drop=True)


def get_cached_dataframe(force_refresh: bool = False) -> pd.DataFrame:
    now = datetime.now(timezone.utc)
    cached_df = _cache["df"]
    loaded_at = _cache["loaded_at"]

    if (
        not force_refresh
        and cached_df is not None
        and loaded_at is not None
        and now - loaded_at < timedelta(seconds=CACHE_TTL_SECONDS)
    ):
        return cached_df.copy()

    try:
        processed = preprocess_dataframe(read_source_dataframe())
        _cache["df"] = processed
        _cache["loaded_at"] = now
        return processed.copy()
    except Exception:
        app.logger.exception("No fue posible cargar los datos del dashboard.")
        if cached_df is not None:
            return cached_df.copy()
        return empty_dataframe()


def apply_filters(frame: pd.DataFrame, year: str, event_type: str, risk_type: str) -> pd.DataFrame:
    df = frame.copy()

    if year != "all" and "anio" in df.columns:
        try:
            df = df[df["anio"] == int(year)]
        except ValueError:
            pass

    if event_type != "all":
        df = df[df["tipo_evento"] == event_type]

    if risk_type != "all":
        df = df[df["tipo_riesgo"] == risk_type]

    return df


def get_filter_options(frame: pd.DataFrame) -> dict[str, list[Any]]:
    years = []
    if "anio" in frame.columns:
        years = sorted(frame["anio"].dropna().astype(int).unique().tolist(), reverse=True)

    event_types = []
    if "tipo_evento" in frame.columns:
        event_types = sorted(frame["tipo_evento"].dropna().astype(str).unique().tolist())

    risk_types = []
    if "tipo_riesgo" in frame.columns:
        risk_types = sorted(frame["tipo_riesgo"].dropna().astype(str).unique().tolist())

    return {
        "years": years,
        "event_types": event_types,
        "risk_types": risk_types,
    }


def build_kpis(frame: pd.DataFrame) -> dict[str, Any]:
    total_events = int(len(frame))
    total_financial_impact = float(frame["impacto_financiero"].sum()) if total_events else 0.0
    average_per_event = float(frame["impacto_financiero"].mean()) if total_events else 0.0
    high_risk_events = int((frame["nivel_riesgo"] == "alto").sum()) if total_events else 0
    high_risk_percentage = round((high_risk_events / total_events) * 100, 1) if total_events else 0.0

    risk_distribution = {
        "alto": int((frame["nivel_riesgo"] == "alto").sum()) if total_events else 0,
        "medio": int((frame["nivel_riesgo"] == "medio").sum()) if total_events else 0,
        "bajo": int((frame["nivel_riesgo"] == "bajo").sum()) if total_events else 0,
    }

    most_costly_event = None
    if total_events and frame["impacto_financiero"].notna().any():
        row = frame.loc[frame["impacto_financiero"].idxmax()]
        most_costly_event = {
            "evento": row["evento"],
            "tipo_evento": row["tipo_evento"],
            "tipo_riesgo": row["tipo_riesgo"],
            "impacto_financiero": float(row["impacto_financiero"]),
            "fecha": row["fecha"].strftime("%Y-%m-%d") if pd.notna(row["fecha"]) else None,
        }

    cost_status = "danger" if total_financial_impact > 0 else "success"
    exposure_status = "danger" if high_risk_percentage >= 35 else ("warning" if high_risk_percentage >= 15 else "success")

    return {
        "total_eventos": total_events,
        "impacto_financiero_total": total_financial_impact,
        "promedio_por_evento": average_per_event,
        "evento_mas_costoso": most_costly_event,
        "porcentaje_alto_riesgo": high_risk_percentage,
        "eventos_alto_riesgo": high_risk_events,
        "distribucion_riesgo": risk_distribution,
        "cards": {
            "impacto_total_status": cost_status,
            "promedio_status": "warning" if average_per_event else "success",
            "evento_costoso_status": "danger" if most_costly_event else "neutral",
            "alto_riesgo_status": exposure_status,
        },
    }


def build_monthly_series(frame: pd.DataFrame) -> list[dict[str, Any]]:
    monthly = (
        frame.dropna(subset=["fecha"])
        .groupby(["mes", "mes_label"], as_index=False)
        .agg(
            eventos=("evento", "size"),
            impacto_financiero=("impacto_financiero", "sum"),
            promedio=("impacto_financiero", "mean"),
        )
        .sort_values("mes")
    )
    return records_from_frame(monthly)


def month_range(start: pd.Timestamp, end: pd.Timestamp) -> list[pd.Timestamp]:
    start_month = pd.Timestamp(year=start.year, month=start.month, day=1)
    end_month = pd.Timestamp(year=end.year, month=end.month, day=1)
    return list(pd.date_range(start_month, end_month, freq="MS"))


def build_event_type_monthly_history(frame: pd.DataFrame) -> dict[str, Any]:
    dated = frame.dropna(subset=["fecha"]).copy()
    if dated.empty:
        return {
            "event_types": [],
            "default_type": "__all__",
            "series_by_type": {"__all__": []},
        }

    now = pd.Timestamp(datetime.now())
    max_date = dated["fecha"].max()
    end_date = max(now, max_date)
    months = month_range(dated["fecha"].min(), end_date)
    month_keys = [month.strftime("%Y-%m") for month in months]
    month_labels = [month_label_from_timestamp(month) for month in months]

    def records_for(filtered: pd.DataFrame) -> list[dict[str, Any]]:
        counts = (
            filtered.assign(mes_key=filtered["fecha"].dt.strftime("%Y-%m"))
            .groupby("mes_key")
            .size()
            .to_dict()
        )
        return [
            {
                "mes": key,
                "mes_label": label,
                "eventos": int(counts.get(key, 0)),
            }
            for key, label in zip(month_keys, month_labels)
        ]

    event_types = sorted(dated["tipo_evento"].dropna().astype(str).unique().tolist())
    series_by_type = {"__all__": records_for(dated)}
    for event_type in event_types:
        series_by_type[event_type] = records_for(dated[dated["tipo_evento"] == event_type])

    return {
        "event_types": event_types,
        "default_type": "__all__",
        "series_by_type": series_by_type,
    }


def build_yearly_comparison(frame: pd.DataFrame) -> list[dict[str, Any]]:
    yearly = (
        frame.dropna(subset=["anio"])
        .groupby("anio", as_index=False)
        .agg(
            eventos=("evento", "size"),
            impacto_financiero=("impacto_financiero", "sum"),
            promedio=("impacto_financiero", "mean"),
        )
        .sort_values("anio")
    )
    return records_from_frame(yearly)


def build_risk_breakdown(frame: pd.DataFrame) -> list[dict[str, Any]]:
    breakdown = (
        frame.groupby("tipo_riesgo", as_index=False)
        .agg(
            eventos=("evento", "size"),
            impacto_financiero=("impacto_financiero", "sum"),
            promedio=("impacto_financiero", "mean"),
            eventos_altos=("nivel_riesgo", lambda values: int((values == "alto").sum())),
        )
        .sort_values(["impacto_financiero", "eventos"], ascending=[False, False])
    )
    return records_from_frame(breakdown)


def build_event_type_breakdown(frame: pd.DataFrame) -> list[dict[str, Any]]:
    breakdown = (
        frame.groupby("tipo_evento", as_index=False)
        .agg(
            eventos=("evento", "size"),
            impacto_financiero=("impacto_financiero", "sum"),
            promedio=("impacto_financiero", "mean"),
            eventos_altos=("nivel_riesgo", lambda values: int((values == "alto").sum())),
        )
        .sort_values(["impacto_financiero", "eventos"], ascending=[False, False])
    )
    return records_from_frame(breakdown)


def build_risk_level_breakdown(frame: pd.DataFrame) -> list[dict[str, Any]]:
    if frame.empty:
        return []

    order = {"alto": 1, "medio": 2, "bajo": 3}
    labels = {"alto": "Alto", "medio": "Medio", "bajo": "Controlado"}
    breakdown = (
        frame.groupby("nivel_riesgo", as_index=False)
        .agg(
            eventos=("evento", "size"),
            impacto_financiero=("impacto_financiero", "sum"),
        )
    )
    breakdown["orden"] = breakdown["nivel_riesgo"].map(order).fillna(99)
    breakdown["nivel_label"] = breakdown["nivel_riesgo"].map(labels).fillna(breakdown["nivel_riesgo"])
    breakdown = breakdown.sort_values("orden")
    return records_from_frame(breakdown[["nivel_riesgo", "nivel_label", "eventos", "impacto_financiero"]])


def build_top_events(frame: pd.DataFrame, limit: int = 10) -> list[dict[str, Any]]:
    if frame.empty:
        return []

    top_events = (
        frame.nlargest(limit, "impacto_financiero")[
            [
                "fecha",
                "evento",
                "tipo_evento",
                "tipo_riesgo",
                "impacto_cualitativo",
                "probabilidad",
                "nivel_riesgo",
                "plan_accion",
                "impacto_financiero",
            ]
        ]
        .copy()
    )

    top_events["fecha"] = top_events["fecha"].dt.strftime("%Y-%m-%d")
    return records_from_frame(top_events)


def build_pareto(frame: pd.DataFrame) -> list[dict[str, Any]]:
    pareto = (
        frame.groupby("tipo_riesgo", as_index=False)
        .agg(impacto_financiero=("impacto_financiero", "sum"))
        .sort_values("impacto_financiero", ascending=False)
    )

    if pareto.empty:
        return []

    total = pareto["impacto_financiero"].sum()
    if total <= 0:
        pareto["participacion"] = 0.0
        pareto["acumulado"] = 0.0
        return records_from_frame(pareto)

    pareto["participacion"] = round((pareto["impacto_financiero"] / total) * 100, 2)
    pareto["acumulado"] = pareto["participacion"].cumsum().round(2)
    return records_from_frame(pareto)


def build_risk_matrix(frame: pd.DataFrame) -> list[dict[str, Any]]:
    matrix = frame.dropna(subset=["evento"]).copy()
    if matrix.empty:
        return []

    matrix["fecha"] = matrix["fecha"].dt.strftime("%Y-%m-%d")

    result = matrix[
        [
            "evento",
            "tipo_evento",
            "tipo_riesgo",
            "fecha",
            "impacto_financiero",
            "impacto_score",
            "probabilidad_score",
            "impacto_cualitativo",
            "probabilidad",
            "nivel_riesgo",
        ]
    ].rename(
        columns={
            "impacto_score": "y",
            "probabilidad_score": "x",
        }
    )

    return records_from_frame(result)


def percentage_change(current: float, previous: float) -> float | None:
    if previous == 0:
        if current == 0:
            return 0.0
        return None
    return round(((current - previous) / abs(previous)) * 100, 1)


def metric_comparison(current: float, previous: float) -> dict[str, Any]:
    delta = current - previous
    return {
        "actual": float(current),
        "anterior": float(previous),
        "delta": float(delta),
        "delta_pct": percentage_change(current, previous),
        "direccion": "up" if delta > 0 else ("down" if delta < 0 else "flat"),
    }


def apply_dimension_filters(frame: pd.DataFrame, event_type: str, risk_type: str) -> pd.DataFrame:
    df = frame.copy()
    if event_type != "all":
        df = df[df["tipo_evento"] == event_type]
    if risk_type != "all":
        df = df[df["tipo_riesgo"] == risk_type]
    return df


def summarize_period(frame: pd.DataFrame) -> dict[str, Any]:
    total_events = int(len(frame))
    total_impact = float(frame["impacto_financiero"].sum()) if total_events else 0.0
    average_impact = float(frame["impacto_financiero"].mean()) if total_events else 0.0
    high_risk_events = int((frame["nivel_riesgo"] == "alto").sum()) if total_events else 0
    high_risk_pct = round((high_risk_events / total_events) * 100, 1) if total_events else 0.0
    average_risk_score = round(float(frame["riesgo_score"].mean()), 1) if total_events else 0.0

    top_risk = None
    if total_events:
        risk_summary = (
            frame.groupby("tipo_riesgo", as_index=False)
            .agg(
                eventos=("evento", "size"),
                impacto_financiero=("impacto_financiero", "sum"),
            )
            .sort_values(["impacto_financiero", "eventos"], ascending=[False, False])
        )
        if not risk_summary.empty:
            row = risk_summary.iloc[0]
            top_risk = {
                "tipo_riesgo": row["tipo_riesgo"],
                "eventos": int(row["eventos"]),
                "impacto_financiero": float(row["impacto_financiero"]),
            }

    top_event_type = None
    if total_events:
        event_type_summary = frame["tipo_evento"].value_counts(dropna=True)
        if not event_type_summary.empty:
            top_event_type = {
                "tipo_evento": str(event_type_summary.index[0]),
                "eventos": int(event_type_summary.iloc[0]),
            }

    return {
        "eventos": total_events,
        "impacto_financiero": total_impact,
        "promedio_por_evento": average_impact,
        "eventos_alto_riesgo": high_risk_events,
        "porcentaje_alto_riesgo": high_risk_pct,
        "riesgo_promedio": average_risk_score,
        "acciones_realizadas": total_events,
        "cobertura_acciones": 100.0 if total_events else 0.0,
        "principal_riesgo": top_risk,
        "tipo_evento_mas_frecuente": top_event_type,
    }


def build_yoy_monthly(current_frame: pd.DataFrame, previous_frame: pd.DataFrame) -> list[dict[str, Any]]:
    def monthly_summary(frame: pd.DataFrame) -> dict[int, dict[str, float]]:
        if frame.empty:
            return {}
        monthly = (
            frame.dropna(subset=["fecha"])
            .assign(mes_num=lambda values: values["fecha"].dt.month)
            .groupby("mes_num", as_index=False)
            .agg(
                eventos=("evento", "size"),
                impacto_financiero=("impacto_financiero", "sum"),
            )
        )
        return {
            int(row["mes_num"]): {
                "eventos": int(row["eventos"]),
                "impacto_financiero": float(row["impacto_financiero"]),
            }
            for _, row in monthly.iterrows()
        }

    current_months = monthly_summary(current_frame)
    previous_months = monthly_summary(previous_frame)

    result = []
    for month in range(1, 13):
        current = current_months.get(month, {"eventos": 0, "impacto_financiero": 0.0})
        previous = previous_months.get(month, {"eventos": 0, "impacto_financiero": 0.0})
        result.append(
            {
                "mes": month,
                "mes_label": MONTH_ABBR.get(month, str(month)),
                "eventos_actual": current["eventos"],
                "eventos_anterior": previous["eventos"],
                "impacto_actual": current["impacto_financiero"],
                "impacto_anterior": previous["impacto_financiero"],
            }
        )
    return result


def build_dimension_yoy(
    current_frame: pd.DataFrame,
    previous_frame: pd.DataFrame,
    dimension: str,
    label_field: str,
    limit: int = 8,
) -> list[dict[str, Any]]:
    values = sorted(
        set(current_frame[dimension].dropna().astype(str).tolist())
        | set(previous_frame[dimension].dropna().astype(str).tolist())
    )
    rows = []
    for value in values:
        current_slice = current_frame[current_frame[dimension].astype(str) == value]
        previous_slice = previous_frame[previous_frame[dimension].astype(str) == value]
        current_events = int(len(current_slice))
        previous_events = int(len(previous_slice))
        current_impact = float(current_slice["impacto_financiero"].sum()) if current_events else 0.0
        previous_impact = float(previous_slice["impacto_financiero"].sum()) if previous_events else 0.0
        impact_delta = current_impact - previous_impact
        event_delta = current_events - previous_events
        rows.append(
            {
                label_field: value,
                "eventos_actual": current_events,
                "eventos_anterior": previous_events,
                "eventos_delta": event_delta,
                "eventos_delta_pct": percentage_change(current_events, previous_events),
                "impacto_actual": current_impact,
                "impacto_anterior": previous_impact,
                "impacto_delta": impact_delta,
                "impacto_delta_pct": percentage_change(current_impact, previous_impact),
                "direccion": "up" if impact_delta > 0 else ("down" if impact_delta < 0 else "flat"),
            }
        )

    return sorted(
        rows,
        key=lambda item: (
            abs(item["impacto_delta"]),
            item["impacto_actual"],
            abs(item["eventos_delta"]),
            item["eventos_actual"],
        ),
        reverse=True,
    )[:limit]


def build_yoy_analysis(base_frame: pd.DataFrame, selected_filters: dict[str, str]) -> dict[str, Any]:
    comparable_frame = apply_dimension_filters(
        base_frame,
        selected_filters.get("event_type", "all"),
        selected_filters.get("risk_type", "all"),
    )
    years = sorted(comparable_frame["anio"].dropna().astype(int).unique().tolist())
    empty = {
        "disponible": False,
        "anio_actual": None,
        "anio_anterior": None,
        "resumen": "No hay datos con fecha suficiente para comparar contra el anio anterior.",
        "actual": summarize_period(empty_dataframe()),
        "anterior": summarize_period(empty_dataframe()),
        "metricas": {},
        "mensual": [],
        "por_tipo_riesgo": [],
        "por_tipo_evento": [],
        "anios_disponibles": years,
    }
    if not years:
        return empty

    selected_year = selected_filters.get("year", "all")
    try:
        current_year = int(selected_year) if selected_year != "all" else max(years)
    except ValueError:
        current_year = max(years)

    previous_year = current_year - 1
    current_frame = comparable_frame[comparable_frame["anio"] == current_year]
    previous_frame = comparable_frame[comparable_frame["anio"] == previous_year]
    current_summary = summarize_period(current_frame)
    previous_summary = summarize_period(previous_frame)

    metrics = {
        "eventos": metric_comparison(current_summary["eventos"], previous_summary["eventos"]),
        "impacto_financiero": metric_comparison(
            current_summary["impacto_financiero"],
            previous_summary["impacto_financiero"],
        ),
        "promedio_por_evento": metric_comparison(
            current_summary["promedio_por_evento"],
            previous_summary["promedio_por_evento"],
        ),
        "porcentaje_alto_riesgo": metric_comparison(
            current_summary["porcentaje_alto_riesgo"],
            previous_summary["porcentaje_alto_riesgo"],
        ),
        "riesgo_promedio": metric_comparison(
            current_summary["riesgo_promedio"],
            previous_summary["riesgo_promedio"],
        ),
    }

    if previous_summary["eventos"]:
        impact_variation = metrics["impacto_financiero"]["delta_pct"]
        impact_text = (
            "variacion no comparable"
            if impact_variation is None
            else f"{impact_variation}% de variacion"
        )
        resumen = (
            f"{current_year} registra {metrics['eventos']['delta']:+.0f} eventos "
            f"y {impact_text} en impacto financiero "
            f"contra {previous_year}."
        )
    else:
        resumen = (
            f"No hay registros en {previous_year} para una comparacion completa. "
            f"Se muestra {current_year} como linea base."
        )

    return {
        "disponible": bool(current_summary["eventos"] or previous_summary["eventos"]),
        "anio_actual": current_year,
        "anio_anterior": previous_year,
        "resumen": resumen,
        "actual": current_summary,
        "anterior": previous_summary,
        "metricas": metrics,
        "mensual": build_yoy_monthly(current_frame, previous_frame),
        "por_tipo_riesgo": build_dimension_yoy(current_frame, previous_frame, "tipo_riesgo", "tipo_riesgo"),
        "por_tipo_evento": build_dimension_yoy(current_frame, previous_frame, "tipo_evento", "tipo_evento"),
        "anios_disponibles": years,
    }


def build_action_record_health(frame: pd.DataFrame) -> dict[str, Any]:
    total_events = int(len(frame))
    if not total_events:
        return {
            "cobertura_porcentaje": 0.0,
            "eventos_con_accion": 0,
            "eventos_sin_accion": 0,
            "eventos_alto_riesgo_sin_accion": 0,
            "status": "neutral",
        }

    return {
        "cobertura_porcentaje": 100.0,
        "eventos_con_accion": total_events,
        "eventos_sin_accion": 0,
        "eventos_alto_riesgo_sin_accion": 0,
        "status": "success",
    }


def build_recent_trend(frame: pd.DataFrame) -> dict[str, Any]:
    monthly = (
        frame.dropna(subset=["fecha"])
        .groupby(["mes", "mes_label"], as_index=False)
        .agg(
            eventos=("evento", "size"),
            impacto_financiero=("impacto_financiero", "sum"),
        )
        .sort_values("mes")
    )

    if monthly.empty:
        return {
            "mes_actual": None,
            "eventos_actuales": 0,
            "impacto_actual": 0.0,
            "delta_eventos": 0,
            "delta_impacto": 0.0,
            "delta_eventos_pct": None,
            "delta_impacto_pct": None,
            "direccion_eventos": "flat",
            "direccion_impacto": "flat",
        }

    current = monthly.iloc[-1]
    previous = monthly.iloc[-2] if len(monthly) > 1 else None
    current_events = int(current["eventos"])
    current_impact = float(current["impacto_financiero"])
    previous_events = int(previous["eventos"]) if previous is not None else 0
    previous_impact = float(previous["impacto_financiero"]) if previous is not None else 0.0
    delta_events = current_events - previous_events
    delta_impact = current_impact - previous_impact

    return {
        "mes_actual": current["mes_label"],
        "eventos_actuales": current_events,
        "impacto_actual": current_impact,
        "delta_eventos": int(delta_events),
        "delta_impacto": float(delta_impact),
        "delta_eventos_pct": percentage_change(current_events, previous_events),
        "delta_impacto_pct": percentage_change(current_impact, previous_impact),
        "direccion_eventos": "up" if delta_events > 0 else ("down" if delta_events < 0 else "flat"),
        "direccion_impacto": "up" if delta_impact > 0 else ("down" if delta_impact < 0 else "flat"),
    }


def build_concentration(frame: pd.DataFrame) -> dict[str, Any]:
    total_events = int(len(frame))
    total_impact = float(frame["impacto_financiero"].sum()) if total_events else 0.0
    if not total_events:
        return {
            "tipo_riesgo": None,
            "participacion_porcentaje": 0.0,
            "impacto_financiero": 0.0,
            "eventos": 0,
            "status": "neutral",
        }

    summary = (
        frame.groupby("tipo_riesgo", as_index=False)
        .agg(
            impacto_financiero=("impacto_financiero", "sum"),
            eventos=("evento", "size"),
        )
        .sort_values(["impacto_financiero", "eventos"], ascending=[False, False])
    )

    top = summary.iloc[0]
    if total_impact > 0:
        share = round((float(top["impacto_financiero"]) / total_impact) * 100, 1)
    else:
        share = round((int(top["eventos"]) / total_events) * 100, 1)

    status = "danger" if share >= 55 else ("warning" if share >= 35 else "success")
    return {
        "tipo_riesgo": top["tipo_riesgo"],
        "participacion_porcentaje": share,
        "impacto_financiero": float(top["impacto_financiero"]),
        "eventos": int(top["eventos"]),
        "status": status,
    }


def build_priority_events(frame: pd.DataFrame, limit: int = 8) -> list[dict[str, Any]]:
    if frame.empty:
        return []

    priority = frame.copy()
    if "accion_status" not in priority.columns:
        priority["accion_status"] = priority["plan_accion"].apply(classify_action_record)

    risk_rank = {"alto": 3, "medio": 2, "bajo": 1}
    priority["nivel_riesgo_rank"] = priority["nivel_riesgo"].map(risk_rank).fillna(0)
    priority = priority.sort_values(
        ["nivel_riesgo_rank", "riesgo_score", "impacto_financiero", "fecha"],
        ascending=[False, False, False, False],
        na_position="last",
    ).head(limit)

    priority["fecha"] = priority["fecha"].dt.strftime("%Y-%m-%d")
    result = priority[
        [
            "fecha",
            "evento",
            "tipo_evento",
            "tipo_riesgo",
            "nivel_riesgo",
            "riesgo_score",
            "impacto_financiero",
            "plan_accion",
            "accion_status",
        ]
    ]
    return records_from_frame(result)


def build_decision_alerts(
    frame: pd.DataFrame,
    action_health: dict[str, Any],
    concentration: dict[str, Any],
    trend: dict[str, Any],
) -> list[dict[str, str]]:
    if frame.empty:
        return [
            {
                "status": "neutral",
                "titulo": "Sin datos para decidir",
                "detalle": "Ajusta filtros o revisa la fuente de datos para generar alertas.",
            }
        ]

    alerts: list[dict[str, str]] = []
    if action_health["eventos_con_accion"]:
        alerts.append(
            {
                "status": "success",
                "titulo": "Acciones realizadas",
                "detalle": f"{action_health['eventos_con_accion']} eventos cuentan con accion realizada documentada.",
            }
        )

    share = concentration["participacion_porcentaje"]
    risk_type = concentration["tipo_riesgo"]
    if risk_type and share >= 35:
        alerts.append(
            {
                "status": concentration["status"],
                "titulo": "Concentracion de exposicion",
                "detalle": f"{risk_type} concentra {share}% del impacto/eventos de la vista actual.",
            }
        )

    impact_delta_pct = trend["delta_impacto_pct"]
    if trend["direccion_impacto"] == "up" and (impact_delta_pct is None or impact_delta_pct >= 20):
        suffix = "desde cero" if impact_delta_pct is None else f"{impact_delta_pct}%"
        alerts.append(
            {
                "status": "warning",
                "titulo": "Impacto mensual en aumento",
                "detalle": f"El impacto financiero del ultimo mes subio {suffix} contra el mes previo.",
            }
        )

    if not alerts:
        alerts.append(
            {
                "status": "success",
                "titulo": "Sin alertas criticas",
                "detalle": "La vista filtrada no muestra brechas urgentes de concentracion o tendencia.",
            }
        )

    return alerts[:4]


def build_decision_panel(frame: pd.DataFrame) -> dict[str, Any]:
    total_events = int(len(frame))
    high_risk_pct = round(((frame["nivel_riesgo"] == "alto").sum() / total_events) * 100, 1) if total_events else 0.0
    average_risk_score = round(float(frame["riesgo_score"].mean()), 1) if total_events else 0.0
    action_health = build_action_record_health(frame)
    trend = build_recent_trend(frame)
    concentration = build_concentration(frame)

    if high_risk_pct >= 35:
        status = "danger"
        status_label = "Critico"
    elif high_risk_pct >= 15:
        status = "warning"
        status_label = "En observacion"
    else:
        status = "success"
        status_label = "Controlado"

    pulse_narrative = (
        f"{high_risk_pct}% de eventos en alto riesgo, score promedio {average_risk_score}/25 "
        f"y acciones registradas en el {action_health['cobertura_porcentaje']}% de los casos."
    )

    return {
        "pulso": {
            "status": status,
            "estado": status_label,
            "alto_riesgo_pct": high_risk_pct,
            "riesgo_promedio": average_risk_score,
            "narrativa": pulse_narrative,
        },
        "acciones": action_health,
        "tendencia": trend,
        "concentracion": concentration,
        "alertas": build_decision_alerts(frame, action_health, concentration, trend),
        "eventos_prioritarios": build_priority_events(frame),
    }


def build_insights(frame: pd.DataFrame) -> dict[str, Any]:
    empty_insights = {
        "principal_riesgo": None,
        "mes_mas_critico": None,
        "evento_mas_costoso": None,
        "tipo_evento_mas_frecuente": None,
        "resumen_ejecutivo": "No hay datos suficientes para generar insights.",
    }

    if frame.empty:
        return empty_insights

    principal_riesgo = None
    risk_summary = (
        frame.groupby("tipo_riesgo", as_index=False)
        .agg(
            impacto_financiero=("impacto_financiero", "sum"),
            eventos=("evento", "size"),
        )
        .sort_values("impacto_financiero", ascending=False)
    )
    if not risk_summary.empty:
        top_risk = risk_summary.iloc[0]
        principal_riesgo = {
            "tipo_riesgo": top_risk["tipo_riesgo"],
            "impacto_financiero": float(top_risk["impacto_financiero"]),
            "eventos": int(top_risk["eventos"]),
        }

    mes_mas_critico = None
    monthly_summary = (
        frame.dropna(subset=["mes", "mes_label"])
        .groupby(["mes", "mes_label"], as_index=False)
        .agg(
            impacto_financiero=("impacto_financiero", "sum"),
            eventos=("evento", "size"),
        )
        .sort_values("impacto_financiero", ascending=False)
    )
    if not monthly_summary.empty:
        top_month = monthly_summary.iloc[0]
        mes_mas_critico = {
            "mes": top_month["mes_label"],
            "impacto_financiero": float(top_month["impacto_financiero"]),
            "eventos": int(top_month["eventos"]),
        }

    evento_mas_costoso = build_kpis(frame)["evento_mas_costoso"]

    tipo_evento_mas_frecuente = None
    event_type_summary = frame["tipo_evento"].value_counts(dropna=True)
    if not event_type_summary.empty:
        tipo_evento_mas_frecuente = {
            "tipo_evento": str(event_type_summary.index[0]),
            "eventos": int(event_type_summary.iloc[0]),
        }

    summary_parts = []
    if principal_riesgo:
        summary_parts.append(
            f"Principal riesgo: {principal_riesgo['tipo_riesgo']} ({principal_riesgo['eventos']} eventos)"
        )
    if mes_mas_critico:
        summary_parts.append(
            f"Mes mas critico: {mes_mas_critico['mes']}"
        )
    if evento_mas_costoso:
        summary_parts.append(
            f"Evento mas costoso: {evento_mas_costoso['evento']}"
        )

    resumen_ejecutivo = " | ".join(summary_parts) if summary_parts else empty_insights["resumen_ejecutivo"]

    return {
        "principal_riesgo": principal_riesgo,
        "mes_mas_critico": mes_mas_critico,
        "evento_mas_costoso": evento_mas_costoso,
        "tipo_evento_mas_frecuente": tipo_evento_mas_frecuente,
        "resumen_ejecutivo": resumen_ejecutivo,
    }


def build_response_payload(
    frame: pd.DataFrame,
    selected_filters: dict[str, str],
    base_frame: Any = None,
) -> dict[str, Any]:
    monthly_series = build_monthly_series(frame)
    yearly_comparison = build_yearly_comparison(frame)
    risk_breakdown = build_risk_breakdown(frame)
    event_type_breakdown = build_event_type_breakdown(frame)
    comparison_base = base_frame if base_frame is not None else frame

    return {
        "decision": build_decision_panel(frame),
        "comparativo_anual": build_yoy_analysis(comparison_base, selected_filters),
        "explorador_eventos": build_event_type_monthly_history(comparison_base),
        "kpis": build_kpis(frame),
        "temporal": {
            "mensual": monthly_series,
            "anual": yearly_comparison,
        },
        "riesgos": {
            "por_tipo": risk_breakdown,
            "por_tipo_evento": event_type_breakdown,
            "por_nivel": build_risk_level_breakdown(frame),
            "top_eventos": build_top_events(frame),
            "pareto": build_pareto(frame),
            "matriz": build_risk_matrix(frame),
        },
        "insights": build_insights(frame),
        "filters": selected_filters,
        "meta": {
            "currency": DASHBOARD_CURRENCY,
            "locale": DASHBOARD_LOCALE,
            "source": DATA_SOURCE,
            "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "records": int(len(frame)),
        },
    }


@app.route("/")
def index() -> str:
    return render_template(
        "dashboard.html",
        dashboard_currency=DASHBOARD_CURRENCY,
        dashboard_locale=DASHBOARD_LOCALE,
        cache_ttl_seconds=CACHE_TTL_SECONDS,
    )


@app.route("/api/datos")
@app.route("/api/dashboard")
def dashboard_data():
    base_frame = get_cached_dataframe()
    selected_filters = {
        "year": request.args.get("year", "all"),
        "event_type": request.args.get("event_type", "all"),
        "risk_type": request.args.get("risk_type", "all"),
    }

    filtered_frame = apply_filters(
        base_frame,
        selected_filters["year"],
        selected_filters["event_type"],
        selected_filters["risk_type"],
    )

    payload = build_response_payload(filtered_frame, selected_filters, base_frame)
    payload["available_filters"] = get_filter_options(base_frame)
    return jsonify(payload)


@app.route("/api/actualizar")
def refresh_dashboard_data():
    _cache["df"] = None
    _cache["loaded_at"] = None
    refreshed = get_cached_dataframe(force_refresh=True)
    return jsonify(
        {
            "success": True,
            "records": int(len(refreshed)),
            "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }
    )


@app.route("/api/debug")
def debug_dashboard_data():
    frame = get_cached_dataframe()
    return jsonify(
        {
            "columns": frame.columns.tolist(),
            "records": int(len(frame)),
            "preview": records_from_frame(frame.head(10)),
            "available_filters": get_filter_options(frame),
            "source": DATA_SOURCE,
            "currency": DASHBOARD_CURRENCY,
        }
    )


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    debug = os.environ.get("FLASK_DEBUG", "true").strip().lower() == "true"
    app.run(host="0.0.0.0", port=port, debug=debug)
