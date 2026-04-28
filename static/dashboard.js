const dashboardConfig = window.dashboardConfig || {};
const dashboardState = {
    charts: {},
    toast: null,
    eventTimeline: null,
};

const palette = [
    "#0f766e",
    "#0284c7",
    "#f97316",
    "#7c3aed",
    "#dc2626",
    "#16a34a",
    "#0891b2",
    "#7c2d12",
    "#1d4ed8",
    "#334155",
];

const locale = dashboardConfig.locale || document.body.dataset.dashboardLocale || "es-AR";
const currency = dashboardConfig.currency || document.body.dataset.dashboardCurrency || "ARS";
const numberFormatter = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
});
const decimalFormatter = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
});
const currencyFormatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: 0,
});
const compactCurrencyFormatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    notation: "compact",
    maximumFractionDigits: 1,
});

Chart.defaults.font.family = '"Manrope", "Segoe UI", sans-serif';
Chart.defaults.color = "#5f6c80";
Chart.defaults.maintainAspectRatio = false;
Chart.defaults.plugins.legend.labels.usePointStyle = true;
Chart.defaults.plugins.legend.labels.boxWidth = 10;
Chart.defaults.elements.line.tension = 0.32;
Chart.defaults.elements.point.radius = 3;
Chart.defaults.layout.padding = {
    top: 18,
    right: 18,
    bottom: 4,
    left: 4,
};

Chart.register({
    id: "dashboardDataLabels",
    afterDatasetsDraw(chart) {
        const options = chart.options.plugins?.dashboardDataLabels || {};
        if (options.display === false) {
            return;
        }

        const { ctx, chartArea } = chart;
        ctx.save();
        ctx.font = options.font || "700 10px Manrope, Segoe UI, sans-serif";
        ctx.textBaseline = "middle";
        ctx.lineJoin = "round";

        chart.data.datasets.forEach((dataset, datasetIndex) => {
            if (!chart.isDatasetVisible(datasetIndex) || dataset.dashboardDataLabels?.display === false) {
                return;
            }

            const meta = chart.getDatasetMeta(datasetIndex);
            const datasetType = dataset.type || chart.config.type;
            meta.data.forEach((element, index) => {
                const raw = dataset.data[index];
                const numericValue = dataLabelNumericValue(raw);
                if (numericValue === 0 && datasetType !== "bubble") {
                    return;
                }

                const label = dataLabelText(chart, dataset, raw, index, datasetType);
                if (!label) {
                    return;
                }

                const position = dataLabelPosition(chart, element, raw, numericValue, datasetType);
                if (!position || position.x < chartArea.left - 24 || position.x > chartArea.right + 24 || position.y < chartArea.top - 18 || position.y > chartArea.bottom + 18) {
                    return;
                }

                ctx.textAlign = position.align;
                ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
                ctx.lineWidth = 4;
                ctx.strokeText(label, position.x, position.y);
                ctx.fillStyle = position.color || "#334155";
                ctx.fillText(label, position.x, position.y);
            });
        });

        ctx.restore();
    },
});

document.addEventListener("DOMContentLoaded", () => {
    dashboardState.toast = new bootstrap.Toast(document.getElementById("appToast"), {
        delay: 3200,
    });

    initializeHelpTips();
    bindDashboardEvents();
    loadDashboard();

    window.setInterval(() => {
        refreshDashboard({ silent: true });
    }, 300000);
});

function bindDashboardEvents() {
    document.getElementById("btnApplyFilters").addEventListener("click", () => loadDashboard());
    document.getElementById("btnClearFilters").addEventListener("click", clearFilters);
    document.getElementById("btnRefresh").addEventListener("click", () => refreshDashboard());
    document.getElementById("eventTimelineType").addEventListener("change", () => {
        renderEventTimelineChart(document.getElementById("eventTimelineType").value);
    });

    ["filterYear", "filterEventType", "filterRiskType"].forEach((id) => {
        document.getElementById(id).addEventListener("change", () => loadDashboard());
    });
}

function getCurrentFilterParams() {
    const params = new URLSearchParams();
    const year = document.getElementById("filterYear").value;
    const eventType = document.getElementById("filterEventType").value;
    const riskType = document.getElementById("filterRiskType").value;

    if (year && year !== "all") {
        params.set("year", year);
    }
    if (eventType && eventType !== "all") {
        params.set("event_type", eventType);
    }
    if (riskType && riskType !== "all") {
        params.set("risk_type", riskType);
    }

    return params;
}

function urlWithParams(baseUrl, params) {
    const query = params.toString();
    return query ? `${baseUrl}?${query}` : baseUrl;
}

function initializeHelpTips() {
    const helpTextByLabel = {
        "#": "Orden de prioridad o ranking dentro de la tabla.",
        "Fuente": "Origen usado por la API: CSV online, CSV local o MySQL.",
        "Ultima actualizacion": "Momento en que se genero esta vista.",
        "Filtros dinamicos": "Segmentan todos los KPIs, graficos y tablas.",
        "Anio": "Anio calendario tomado desde la fecha del evento.",
        "Tipo de evento": "Categoria operativa del evento. Sirve para ver recurrencias.",
        "Tipo de riesgo": "Familia de riesgo asociada o inferida desde el evento.",
        "Vista actual": "Resumen de filtros activos en esta lectura.",
        "Decision board": "Lectura ejecutiva de estado, tendencia y prioridades.",
        "Pulso ejecutivo y accion inmediata": "Bloque para ver estado general, concentracion, tendencia y eventos prioritarios.",
        "Postura de riesgo": "Cuenta % de eventos altos. Alto = riesgo_score >= 12.",
        "Acciones registradas": "Cuenta eventos con accion realizada documentada. En esta fuente representa 100%.",
        "Concentracion principal": "Muestra cuanto pesa el riesgo dominante sobre impacto o frecuencia.",
        "Alertas": "Senales automaticas para interpretar foco de gestion.",
        "Cola de accion": "Ranking de eventos por severidad, score, impacto y fecha.",
        "Comparativo interanual": "Compara el anio actual o seleccionado contra el anterior.",
        "Analisis profundo contra el anio anterior": "Compara volumen, impacto, promedio, severidad y cambios por categoria frente al anio previo.",
        "Lectura YoY": "Resume la diferencia del anio actual frente al previo.",
        "Eventos": "Cuenta registros validos despues de aplicar filtros.",
        "Impacto": "Suma o delta de impacto financiero segun la tabla.",
        "Impacto financiero": "Suma de impacto_financiero. Indica exposicion economica.",
        "Promedio por evento": "Impacto total dividido por cantidad de eventos.",
        "Alto riesgo": "Eventos altos sobre total. Leerlo como peso de severidad.",
        "Score": "Riesgo_score del evento: impacto_score x probabilidad_score.",
        "Score medio": "Promedio de riesgo_score. Maximo teorico: 25.",
        "Delta": "Diferencia contra el anio anterior: actual menos anterior.",
        "Accion realizada": "Descripcion de lo realizado para el evento.",
        "Eventos YoY": "Cuenta eventos por mes y compara actual vs anio anterior.",
        "Impacto YoY": "Suma impacto mensual y compara actual vs anio anterior.",
        "Delta por riesgo": "Compara impacto actual menos impacto anterior por familia.",
        "Variacion interanual de impacto por tipo de riesgo": "Barras de delta: positivo sube contra el anio anterior; negativo baja.",
        "Comparacion YoY": "Compara contra el anio anterior con los mismos filtros activos.",
        "Cambio por riesgo": "Variacion por familia de riesgo contra el anio anterior.",
        "Cambio por evento": "Variacion por categoria de evento contra el anio anterior.",
        "Insights automaticos": "Lecturas calculadas para explicar concentraciones clave.",
        "Lectura ejecutiva del negocio": "Sintesis automatica de riesgos, meses y eventos mas relevantes.",
        "Principal riesgo del negocio": "Riesgo con mayor suma de impacto financiero.",
        "Mes mas critico": "Mes con mayor impacto financiero acumulado.",
        "Evento mas costoso": "Evento individual con mayor impacto_financiero.",
        "Tipo de evento mas frecuente": "Categoria con mayor cantidad de eventos.",
        "Nivel 1": "KPIs principales de volumen, impacto y severidad.",
        "KPIs ejecutivos": "Indicadores base para dimensionar volumen, exposicion, promedio y severidad.",
        "Total de eventos": "Conteo total de registros filtrados.",
        "Impacto financiero total": "Suma de impacto_financiero filtrado.",
        "% de eventos de alto riesgo": "Eventos con riesgo_score >= 12 dividido por total.",
        "Nivel 2": "Evolucion por mes y por anio.",
        "Analisis temporal": "Evolucion de eventos e impacto para detectar picos y comparaciones anuales.",
        "Tendencia": "Cuenta eventos por mes para detectar picos.",
        "Costo mensual": "Suma impacto_financiero por mes.",
        "Comparativo": "Barras: impacto anual. Linea: eventos anuales.",
        "Nivel 3": "Analisis por familias de riesgo y eventos prioritarios.",
        "Analisis de riesgo": "Desglosa frecuencia, impacto, concentracion y eventos mas relevantes por riesgo.",
        "Frecuencia": "Cuenta eventos por tipo_riesgo.",
        "Perdida": "Suma impacto_financiero por tipo_riesgo.",
        "Severidad": "Distribuye eventos entre alto, medio y controlado.",
        "Distribucion por nivel de riesgo": "Cuenta eventos por nivel_riesgo.",
        "Dona": "Grafico circular para ver composicion del total.",
        "Tipo de evento": "Compara categorias operativas por cantidad.",
        "Eventos por tipo de evento": "Cuenta eventos por tipo_evento.",
        "Impacto por evento": "Compara categorias operativas por impacto financiero.",
        "Impacto por tipo de evento": "Suma impacto_financiero por tipo_evento.",
        "Priorizacion": "Pareto: participacion y acumulado del impacto.",
        "Prioridad": "Top eventos por impacto financiero.",
        "Nivel 4": "Matriz de probabilidad, impacto y peso financiero de riesgos externos.",
        "Matriz externa": "Cruza eventos externos por probabilidad, impacto y peso financiero.",
        "Riesgo externo": "Eventos originados fuera del control directo de la operacion.",
        "Alto": "Riesgo_score >= 12.",
        "Medio": "Riesgo_score entre 6 y 11.",
        "Controlado": "Riesgo_score menor a 6.",
        "Focos de gestion": "Comentarios automaticos sobre tendencia, severidad y concentracion.",
        "Eventos prioritarios por severidad": "Ordena eventos por riesgo, score, impacto y fecha.",
        "Eventos mensuales vs anio anterior": "Compara conteo mensual actual contra el mismo mes previo.",
        "Impacto mensual vs anio anterior": "Compara impacto mensual actual contra el mismo mes previo.",
        "Familias que mas variaron": "Muestra mayores cambios por tipo_riesgo.",
        "Tipos de evento que mas variaron": "Muestra mayores cambios por tipo_evento.",
        "Distribucion de niveles de riesgo": "Cuenta eventos altos, medios y controlados.",
        "Eventos por mes": "Cuenta eventos agrupados por mes.",
        "Impacto financiero por mes": "Suma impacto_financiero agrupado por mes.",
        "Comparacion anio a anio": "Impacto anual y cantidad de eventos por anio.",
        "Eventos por tipo de riesgo": "Cuenta eventos por familia de riesgo.",
        "Impacto financiero por tipo": "Suma impacto por familia de riesgo.",
        "Pareto 80/20 de impacto financiero": "Ordena riesgos por impacto y muestra acumulado.",
        "Top 10 eventos con mayor impacto": "Diez eventos con mayor impacto_financiero.",
        "Probabilidad vs impacto con peso financiero": "Cada burbuja es un evento; derecha = mas probable, arriba = mayor impacto, grande = mayor costo.",
        "Analisis de matriz de riesgos externos": "Vista para priorizar eventos externos segun probabilidad, impacto e impacto financiero.",
        "Serie historica": "Serie mensual completa desde el primer dato hasta el mes actual.",
        "Cantidad mensual de eventos por tipo": "Cuenta eventos por mes y permite cambiar la vista por tipo de evento.",
        "Eventos mensuales": "Barras mensuales de cantidad de eventos.",
        "Historial mensual con gatillo por tipo de evento": "Usa el selector para ver todos los tipos o un tipo de evento especifico.",
        "Desde el primer dato hasta la actualidad": "Incluye meses sin eventos como cero para mantener continuidad temporal.",
        "Todos los tipos": "Suma mensual de todos los tipos de evento.",
        "Visibilidad": "Indica volumen de eventos considerados.",
        "Exposicion": "Indica impacto economico acumulado.",
        "Eficiencia": "Indica costo promedio por evento.",
        "Criticidad": "Senala el evento individual mas costoso.",
        "Severidad": "Indica peso de eventos de alto riesgo.",
        "Line chart": "Linea temporal para ver tendencias y picos.",
        "Combo chart": "Combina barras y linea para comparar dos metricas.",
        "Barras": "Barras horizontales para comparar categorias.",
        "Pareto": "Barras ordenadas y linea acumulada para priorizar.",
        "Tabla": "Detalle ordenado para leer casos concretos.",
        "Bubble chart": "Burbujas para cruzar probabilidad, impacto y monto.",
        "Comparativo mensual": "Compara mes contra el mismo mes del anio anterior.",
        "Delta impacto": "Variacion de impacto: actual menos anio anterior.",
        "Riesgo + impacto": "Prioridad calculada por severidad y materialidad.",
    };

    const selector = [
        ".meta-label",
        ".section-badge",
        ".section-title",
        ".form-label",
        ".decision-label",
        ".chart-overline",
        ".chart-card-header h3",
        ".summary-label",
        ".yoy-label",
        ".insight-label",
        ".kpi-label",
        ".chart-pill",
        ".kpi-tag",
        ".active-filter-label",
        ".decision-metrics span",
        ".distribution-copy h3",
        ".distribution-label span",
        ".app-table thead th",
    ].join(", ");

    document.querySelectorAll(selector).forEach((element) => {
        if (element.querySelector(".help-tip")) {
            return;
        }

        const label = getLabelText(element);
        const helpText = helpTextByLabel[label] || "Explica el alcance de esta etiqueta dentro del dashboard.";
        const help = document.createElement("span");
        help.className = "help-tip";
        help.setAttribute("role", "button");
        help.setAttribute("tabindex", "0");
        help.setAttribute("aria-label", `Ayuda: ${label}`);
        help.setAttribute("data-bs-toggle", "tooltip");
        help.setAttribute("data-bs-title", helpText);
        help.setAttribute("data-bs-placement", "top");
        help.setAttribute("data-bs-custom-class", "dashboard-tooltip");
        help.innerHTML = '<i class="bi bi-info"></i>';
        element.appendChild(help);
    });

    const tooltipElements = document.querySelectorAll('[data-bs-toggle="tooltip"]');
    tooltipElements.forEach((element) => {
        const instance = bootstrap.Tooltip.getOrCreateInstance(element, {
            container: "body",
            trigger: "hover focus click",
        });

        element.addEventListener("click", (event) => {
            event.stopPropagation();
            tooltipElements.forEach((otherElement) => {
                if (otherElement !== element) {
                    bootstrap.Tooltip.getInstance(otherElement)?.hide();
                }
            });
            instance.show();
        });
    });

    document.addEventListener("click", (event) => {
        if (event.target.closest(".help-tip")) {
            return;
        }
        tooltipElements.forEach((element) => {
            bootstrap.Tooltip.getInstance(element)?.hide();
        });
    });
}

function getLabelText(element) {
    const textNode = Array.from(element.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
    return (textNode?.textContent || element.textContent || "").replace(/\s+/g, " ").trim();
}

function clearFilters() {
    document.getElementById("filterYear").value = "all";
    document.getElementById("filterEventType").value = "all";
    document.getElementById("filterRiskType").value = "all";
    loadDashboard();
}

async function refreshDashboard({ silent = false } = {}) {
    try {
        setLoadingState(true);
        const response = await fetch(dashboardConfig.refreshUrl, { cache: "no-store" });
        if (!response.ok) {
            throw new Error("No fue posible refrescar el cache.");
        }

        await response.json();
        await loadDashboard({ silent: true });

        if (!silent) {
            showToast("Datos actualizados correctamente.");
        }
    } catch (error) {
        console.error(error);
        showToast("No fue posible actualizar los datos.", true);
    } finally {
        setLoadingState(false);
    }
}

async function loadDashboard({ silent = false } = {}) {
    try {
        setLoadingState(true);

        const url = urlWithParams(dashboardConfig.apiUrl, getCurrentFilterParams());

        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) {
            throw new Error("La API devolvio un error.");
        }

        const payload = await response.json();

        renderFilterOptions(payload.available_filters, payload.filters);
        renderMeta(payload.meta);
        renderDecisionPanel(payload.decision);
        renderYearOverYear(payload.comparativo_anual);
        renderInsights(payload.insights);
        renderKpis(payload.kpis);
        renderTemporal(payload.temporal);
        renderRisks(payload.riesgos);
        renderEventTimeline(payload.explorador_eventos);
        hideErrorState();

        if (!silent) {
            showToast("Dashboard actualizado.");
        }
    } catch (error) {
        console.error(error);
        renderEmptyDashboard("No fue posible cargar el dashboard.");
        showToast("No fue posible cargar el dashboard.", true);
    } finally {
        setLoadingState(false);
    }
}

function setLoadingState(isLoading) {
    const controls = [
        document.getElementById("btnRefresh"),
        document.getElementById("btnApplyFilters"),
        document.getElementById("btnClearFilters"),
        document.getElementById("filterYear"),
        document.getElementById("filterEventType"),
        document.getElementById("filterRiskType"),
    ];

    controls.forEach((element) => {
        element.disabled = isLoading;
    });

    document.querySelector("main").classList.toggle("is-loading", isLoading);
}

function renderFilterOptions(options = {}, selected = {}) {
    updateSelect(
        document.getElementById("filterYear"),
        options.years || [],
        selected.year || "all",
        "Todos"
    );
    updateSelect(
        document.getElementById("filterEventType"),
        options.event_types || [],
        selected.event_type || "all",
        "Todos"
    );
    updateSelect(
        document.getElementById("filterRiskType"),
        options.risk_types || [],
        selected.risk_type || "all",
        "Todos"
    );
    renderActiveFilters(selected);
}

function updateSelect(select, values, selectedValue, defaultLabel) {
    const currentValue = String(selectedValue || select.value || "all");
    const stringValues = values.map((value) => String(value));
    const options = [`<option value="all">${defaultLabel}</option>`];

    values.forEach((value) => {
        const escaped = escapeHtml(String(value));
        options.push(
            `<option value="${escaped}" ${String(value) === currentValue ? "selected" : ""}>${escaped}</option>`
        );
    });

    select.innerHTML = options.join("");
    if (!stringValues.includes(currentValue)) {
        select.value = "all";
    }
}

function renderActiveFilters(selected = {}) {
    const chips = [];
    if (selected.year && selected.year !== "all") {
        chips.push(["Anio", selected.year]);
    }
    if (selected.event_type && selected.event_type !== "all") {
        chips.push(["Evento", selected.event_type]);
    }
    if (selected.risk_type && selected.risk_type !== "all") {
        chips.push(["Riesgo", selected.risk_type]);
    }

    const container = document.getElementById("activeFilterChips");
    if (!chips.length) {
        container.innerHTML = `<span class="filter-chip">Todos los datos</span>`;
        return;
    }

    container.innerHTML = chips
        .map(([label, value]) => (
            `<span class="filter-chip"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</span>`
        ))
        .join("");
}

function renderMeta(meta = {}) {
    document.getElementById("metaSource").textContent = formatSource(meta.source);
    document.getElementById("metaGeneratedAt").textContent = meta.generated_at || "-";
    document.getElementById("recordCounter").textContent = `${formatNumber(meta.records || 0)} eventos analizados`;
}

function renderDecisionPanel(decision = {}) {
    const pulse = decision.pulso || {};
    const actions = decision.acciones || {};
    const concentration = decision.concentracion || {};
    const trend = decision.tendencia || {};

    applyDecisionStatus(document.getElementById("riskPulseCard"), pulse.status || "neutral");
    applyDecisionStatus(document.getElementById("planCoverageCard"), actions.status || "neutral");
    applyDecisionStatus(document.getElementById("concentrationCard"), concentration.status || "neutral");

    document.getElementById("decisionStatusKicker").textContent = `Estado: ${pulse.estado || "Pendiente"}`;
    document.getElementById("riskPulseState").textContent = pulse.estado || "Pendiente";
    document.getElementById("riskPulseHighRisk").textContent = `${formatDecimal(pulse.alto_riesgo_pct || 0)}%`;
    document.getElementById("riskPulseNarrative").textContent =
        pulse.narrativa || "No hay datos suficientes para calcular el pulso.";
    document.getElementById("riskPulseAverage").textContent = `${formatDecimal(pulse.riesgo_promedio || 0)}/25`;
    document.getElementById("riskPulseMonth").textContent = trend.mes_actual || "-";

    document.getElementById("planCoverageStatus").textContent = statusLabel(actions.status);
    document.getElementById("planCoverageValue").textContent = `${formatDecimal(actions.cobertura_porcentaje || 0)}%`;
    document.getElementById("planCoverageNote").textContent =
        `${formatNumber(actions.eventos_con_accion || 0)} eventos con accion realizada documentada`;
    setBarWidth(document.getElementById("planCoverageBar"), actions.cobertura_porcentaje || 0, 100);

    document.getElementById("concentrationStatus").textContent = statusLabel(concentration.status);
    document.getElementById("concentrationValue").textContent = `${formatDecimal(concentration.participacion_porcentaje || 0)}%`;
    document.getElementById("concentrationNote").textContent = concentration.tipo_riesgo
        ? `${concentration.tipo_riesgo} | ${formatCurrency(concentration.impacto_financiero || 0)} | ${formatNumber(concentration.eventos || 0)} eventos`
        : "Sin concentracion calculada.";

    const trendChip = document.getElementById("impactTrendChip");
    const trendDirection = trend.direccion_impacto || "flat";
    trendChip.className = `trend-chip trend-${trendDirection}`;
    trendChip.textContent = formatImpactTrend(trend);

    renderDecisionAlerts(decision.alertas || []);
    renderPriorityEventsTable(decision.eventos_prioritarios || []);
}

function renderYearOverYear(comparison = {}) {
    const currentYear = comparison.anio_actual;
    const previousYear = comparison.anio_anterior;
    const metrics = comparison.metricas || {};
    const monthly = comparison.mensual || [];

    document.getElementById("yoyPeriod").textContent =
        currentYear && previousYear ? `${currentYear} vs ${previousYear}` : "Sin periodo comparable";
    document.getElementById("yoySummary").textContent =
        comparison.resumen || "No hay datos suficientes para comparar contra el anio anterior.";

    renderYoyMetric(
        "yoyEventsCard",
        "yoyEventsValue",
        "yoyEventsDelta",
        metrics.eventos,
        (value) => formatNumber(value),
        "eventos"
    );
    renderYoyMetric(
        "yoyImpactCard",
        "yoyImpactValue",
        "yoyImpactDelta",
        metrics.impacto_financiero,
        (value) => formatCurrency(value)
    );
    renderYoyMetric(
        "yoyAverageCard",
        "yoyAverageValue",
        "yoyAverageDelta",
        metrics.promedio_por_evento,
        (value) => formatCurrency(value)
    );
    renderYoyPercentMetric(
        "yoyHighRiskCard",
        "yoyHighRiskValue",
        "yoyHighRiskDelta",
        metrics.porcentaje_alto_riesgo
    );
    renderYoyMetric(
        "yoyRiskScoreCard",
        "yoyRiskScoreValue",
        "yoyRiskScoreDelta",
        metrics.riesgo_promedio,
        (value) => `${formatDecimal(value)}/25`
    );

    renderYoyCharts(monthly, currentYear, previousYear);
    renderYoyRiskDeltaChart(comparison.por_tipo_riesgo || []);
    renderYoyDimensionTable("yoyRiskTable", comparison.por_tipo_riesgo || [], "tipo_riesgo");
    renderYoyDimensionTable("yoyEventTypeTable", comparison.por_tipo_evento || [], "tipo_evento");
}

function renderYoyMetric(cardId, valueId, deltaId, metric, formatter, unit = "") {
    const card = document.getElementById(cardId);
    if (!metric) {
        document.getElementById(valueId).textContent = "-";
        document.getElementById(deltaId).textContent = "Sin comparacion";
        applyYoyDirection(card, "flat");
        return;
    }

    document.getElementById(valueId).textContent = formatter(metric.actual || 0);
    document.getElementById(deltaId).textContent = formatDeltaText(metric, formatter, unit);
    applyYoyDirection(card, metric.direccion || "flat");
}

function renderYoyPercentMetric(cardId, valueId, deltaId, metric) {
    const card = document.getElementById(cardId);
    if (!metric) {
        document.getElementById(valueId).textContent = "-";
        document.getElementById(deltaId).textContent = "Sin comparacion";
        applyYoyDirection(card, "flat");
        return;
    }

    const delta = Number(metric.delta || 0);
    const sign = delta > 0 ? "+" : "";
    const relative = metric.delta_pct === null || metric.delta_pct === undefined
        ? "sin base previa"
        : `${signedDecimal(metric.delta_pct)}% relativo`;
    document.getElementById(valueId).textContent = `${formatDecimal(metric.actual || 0)}%`;
    document.getElementById(deltaId).textContent = `${sign}${formatDecimal(delta)} pp | ${relative}`;
    applyYoyDirection(card, metric.direccion || "flat");
}

function applyYoyDirection(card, direction) {
    ["yoy-up", "yoy-down", "yoy-flat"].forEach((klass) => card.classList.remove(klass));
    card.classList.add(`yoy-${direction || "flat"}`);
}

function formatDeltaText(metric, formatter, unit = "") {
    const delta = Number(metric.delta || 0);
    const deltaText = signedFormatted(delta, formatter);
    const pctText = metric.delta_pct === null || metric.delta_pct === undefined
        ? "sin base previa"
        : `${signedDecimal(metric.delta_pct)}%`;
    const unitText = unit ? ` ${unit}` : "";
    return `${deltaText}${unitText} | ${pctText} vs anio anterior`;
}

function renderYoyCharts(monthly, currentYear, previousYear) {
    const labels = monthly.map((item) => item.mes_label);

    upsertChart("chartYoyEvents", {
        type: "bar",
        data: {
            labels,
            datasets: [
                {
                    label: String(previousYear || "Anterior"),
                    data: monthly.map((item) => item.eventos_anterior),
                    backgroundColor: "rgba(148, 163, 184, 0.46)",
                    borderRadius: 10,
                    maxBarThickness: 26,
                },
                {
                    label: String(currentYear || "Actual"),
                    data: monthly.map((item) => item.eventos_actual),
                    backgroundColor: "rgba(15, 118, 110, 0.84)",
                    borderRadius: 10,
                    maxBarThickness: 26,
                },
            ],
        },
        options: {
            plugins: {
                tooltip: {
                    callbacks: {
                        label: (context) => `${context.dataset.label}: ${formatNumber(context.raw)} eventos`,
                    },
                },
            },
            scales: {
                x: gridlessAxis(),
                y: integerAxis("Eventos"),
            },
        },
    });

    upsertChart("chartYoyImpact", {
        type: "line",
        data: {
            labels,
            datasets: [
                {
                    label: String(previousYear || "Anterior"),
                    data: monthly.map((item) => item.impacto_anterior),
                    borderColor: "#94a3b8",
                    backgroundColor: "rgba(148, 163, 184, 0.12)",
                    borderDash: [6, 6],
                    borderWidth: 3,
                    fill: true,
                },
                {
                    label: String(currentYear || "Actual"),
                    data: monthly.map((item) => item.impacto_actual),
                    borderColor: "#0284c7",
                    backgroundColor: "rgba(2, 132, 199, 0.14)",
                    borderWidth: 3,
                    fill: true,
                },
            ],
        },
        options: {
            plugins: {
                tooltip: {
                    callbacks: {
                        label: (context) => `${context.dataset.label}: ${formatCurrency(context.raw)}`,
                    },
                },
            },
            scales: {
                x: gridlessAxis(),
                y: currencyAxis("Impacto financiero"),
            },
        },
    });
}

function renderYoyRiskDeltaChart(rows) {
    const sortedRows = [...rows]
        .sort((a, b) => Math.abs(b.impacto_delta || 0) - Math.abs(a.impacto_delta || 0))
        .slice(0, 8)
        .reverse();

    upsertChart("chartYoyRiskDelta", {
        type: "bar",
        data: {
            labels: sortedRows.map((item) => item.tipo_riesgo),
            datasets: [
                {
                    label: "Delta impacto",
                    data: sortedRows.map((item) => item.impacto_delta || 0),
                    dashboardDataLabels: {
                        formatter: (value) => signedFormatted(value, formatCompactCurrency),
                        minAbs: 1,
                    },
                    backgroundColor: sortedRows.map((item) => (
                        (item.impacto_delta || 0) >= 0
                            ? "rgba(239, 68, 68, 0.72)"
                            : "rgba(22, 163, 74, 0.72)"
                    )),
                    borderRadius: 10,
                    maxBarThickness: 30,
                },
            ],
        },
        options: {
            indexAxis: "y",
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (context) => `Delta: ${signedFormatted(context.raw, formatCurrency)}`,
                    },
                },
            },
            scales: {
                x: deltaCurrencyAxis("Delta impacto", sortedRows.map((item) => item.impacto_delta || 0)),
                y: gridlessAxis(),
            },
        },
    });
}

function renderYoyDimensionTable(tableId, rows, labelField) {
    const tbody = document.querySelector(`#${tableId} tbody`);
    if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="4" class="empty-cell">No hay datos comparables para mostrar.</td></tr>`;
        return;
    }

    tbody.innerHTML = rows
        .map((row) => {
            const deltaClass = row.impacto_delta > 0 ? "delta-positive" : (row.impacto_delta < 0 ? "delta-negative" : "delta-flat");
            return `
                <tr>
                    <td>
                        <p class="table-title">${escapeHtml(row[labelField] || "Sin clasificar")}</p>
                    </td>
                    <td>
                        <strong>${formatNumber(row.eventos_actual || 0)}</strong>
                        <span class="table-note">Antes: ${formatNumber(row.eventos_anterior || 0)} | ${signedFormatted(row.eventos_delta || 0, formatNumber)}</span>
                    </td>
                    <td class="amount-cell">${formatCurrency(row.impacto_actual || 0)}</td>
                    <td>
                        <span class="delta-badge ${deltaClass}">${signedFormatted(row.impacto_delta || 0, formatCompactCurrency)}</span>
                        <span class="table-note">${formatNullablePercent(row.impacto_delta_pct)}</span>
                    </td>
                </tr>
            `;
        })
        .join("");
}

function applyDecisionStatus(card, status) {
    ["decision-status-neutral", "decision-status-danger", "decision-status-warning", "decision-status-success"].forEach((klass) => {
        card.classList.remove(klass);
    });

    const statusClassMap = {
        neutral: "decision-status-neutral",
        danger: "decision-status-danger",
        warning: "decision-status-warning",
        success: "decision-status-success",
    };

    card.classList.add(statusClassMap[status] || "decision-status-neutral");
}

function statusLabel(status) {
    const labels = {
        danger: "Critico",
        warning: "Atencion",
        success: "Controlado",
        neutral: "Pendiente",
    };
    return labels[status] || labels.neutral;
}

function formatImpactTrend(trend = {}) {
    if (!trend.mes_actual) {
        return "Sin tendencia mensual";
    }

    const delta = Number(trend.delta_impacto || 0);
    const signedCurrency = `${delta > 0 ? "+" : ""}${formatCompactCurrency(delta)}`;
    if (trend.delta_impacto_pct === null || trend.delta_impacto_pct === undefined) {
        return `Impacto mensual ${signedCurrency} vs mes previo`;
    }

    const percent = Number(trend.delta_impacto_pct) || 0;
    const signedPercent = `${percent > 0 ? "+" : ""}${formatDecimal(percent)}%`;
    return `Impacto mensual ${signedCurrency} (${signedPercent})`;
}

function renderDecisionAlerts(alerts) {
    const container = document.getElementById("decisionAlerts");
    if (!alerts.length) {
        container.innerHTML = `
            <div class="action-item action-neutral">
                <strong>Sin alertas</strong>
                <span>No hay focos de gestion para la vista actual.</span>
            </div>
        `;
        return;
    }

    container.innerHTML = alerts
        .map((alert) => `
            <div class="action-item action-${escapeHtml(alert.status || "neutral")}">
                <strong>${escapeHtml(alert.titulo || "Alerta")}</strong>
                <span>${escapeHtml(alert.detalle || "")}</span>
            </div>
        `)
        .join("");
}

function renderPriorityEventsTable(events) {
    const tbody = document.querySelector("#priorityEventsTable tbody");

    if (!events.length) {
        tbody.innerHTML = `<tr><td colspan="5" class="empty-cell">No hay eventos prioritarios para mostrar.</td></tr>`;
        return;
    }

    tbody.innerHTML = events
        .map((event, index) => {
            const riskClass = riskPillClass(event.nivel_riesgo);
            const actionClass = event.accion_status === "accion_realizada" ? "pill-action-ok" : "pill-action-missing";
            const actionText = event.accion_status === "accion_realizada" ? "Realizada" : "Sin registro";
            return `
                <tr>
                    <td class="table-rank">${index + 1}</td>
                    <td>
                        <p class="table-title">${escapeHtml(event.evento || "Sin descripcion")}</p>
                        <span class="table-subtitle">${escapeHtml(event.tipo_evento || "Sin tipo")} | ${escapeHtml(event.fecha || "Sin fecha")}</span>
                    </td>
                    <td>
                        <span class="pill-risk ${riskClass}">
                            ${escapeHtml(capitalize(event.nivel_riesgo || "bajo"))}
                        </span>
                        <span class="table-note">${escapeHtml(event.tipo_riesgo || "Sin clasificar")}</span>
                    </td>
                    <td class="amount-cell">${formatNumber(event.riesgo_score || 0)}</td>
                    <td>
                        <span class="pill-action ${actionClass}">${actionText}</span>
                        <span class="table-note">${escapeHtml(truncateText(event.plan_accion || "Accion realizada", 44))}</span>
                    </td>
                </tr>
            `;
        })
        .join("");
}

function renderInsights(insights = {}) {
    document.getElementById("executiveSummary").textContent =
        insights.resumen_ejecutivo || "No hay datos suficientes para generar insights.";

    const principalRisk = insights.principal_riesgo;
    document.getElementById("insightPrincipalRisk").textContent =
        principalRisk?.tipo_riesgo || "Sin registros";
    document.getElementById("insightPrincipalRiskNote").textContent = principalRisk
        ? `${formatCurrency(principalRisk.impacto_financiero)} acumulados en ${formatNumber(principalRisk.eventos)} eventos`
        : "No hay materialidad economica disponible.";

    const criticalMonth = insights.mes_mas_critico;
    document.getElementById("insightCriticalMonth").textContent =
        criticalMonth?.mes || "Sin registros";
    document.getElementById("insightCriticalMonthNote").textContent = criticalMonth
        ? `${formatCurrency(criticalMonth.impacto_financiero)} en ${formatNumber(criticalMonth.eventos)} eventos`
        : "No hay meses con datos consolidados.";

    const costliestEvent = insights.evento_mas_costoso;
    document.getElementById("insightCostliestEvent").textContent =
        truncateText(costliestEvent?.evento || "Sin registros", 52);
    document.getElementById("insightCostliestEventNote").textContent = costliestEvent
        ? `${formatCurrency(costliestEvent.impacto_financiero)}${costliestEvent.fecha ? ` | ${costliestEvent.fecha}` : ""}`
        : "No hay eventos priorizados.";

    const frequentEventType = insights.tipo_evento_mas_frecuente;
    document.getElementById("insightFrequentEventType").textContent =
        truncateText(frequentEventType?.tipo_evento || "Sin registros", 52);
    document.getElementById("insightFrequentEventTypeNote").textContent = frequentEventType
        ? `${formatNumber(frequentEventType.eventos)} eventos concentrados en esta categoria`
        : "No hay categorias disponibles.";
}

function renderKpis(kpis = {}) {
    document.getElementById("kpiTotalEvents").textContent = formatNumber(kpis.total_eventos || 0);
    document.getElementById("kpiTotalImpact").textContent = formatCurrency(kpis.impacto_financiero_total || 0);
    document.getElementById("kpiAveragePerEvent").textContent = formatCurrency(kpis.promedio_por_evento || 0);
    document.getElementById("kpiHighRiskPercent").textContent = `${formatDecimal(kpis.porcentaje_alto_riesgo || 0)}%`;

    applyKpiStatus(document.getElementById("kpiTotalImpactCard"), kpis.cards?.impacto_total_status || "danger");
    applyKpiStatus(document.getElementById("kpiAverageCard"), kpis.cards?.promedio_status || "warning");
    applyKpiStatus(document.getElementById("kpiCostliestCard"), kpis.cards?.evento_costoso_status || "danger");
    applyKpiStatus(document.getElementById("kpiHighRiskCard"), kpis.cards?.alto_riesgo_status || "success");

    document.getElementById("kpiTotalImpactNote").textContent =
        `${formatCompactCurrency(kpis.impacto_financiero_total || 0)} en perdida acumulada.`;
    document.getElementById("kpiHighRiskNote").textContent =
        `${formatNumber(kpis.eventos_alto_riesgo || 0)} eventos se ubican en riesgo alto.`;

    const costliest = kpis.evento_mas_costoso;
    document.getElementById("kpiCostliestEvent").textContent =
        truncateText(costliest?.evento || "Sin registros", 42);
    document.getElementById("kpiCostliestEventNote").textContent = costliest
        ? `${formatCurrency(costliest.impacto_financiero)} | ${costliest.tipo_riesgo || "Sin riesgo"}`
        : "No hay eventos materializados.";

    const distribution = kpis.distribucion_riesgo || {};
    const total = kpis.total_eventos || 0;
    const high = distribution.alto || 0;
    const medium = distribution.medio || 0;
    const low = distribution.bajo || 0;

    document.getElementById("riskCountHigh").textContent = formatNumber(high);
    document.getElementById("riskCountMedium").textContent = formatNumber(medium);
    document.getElementById("riskCountLow").textContent = formatNumber(low);

    setBarWidth(document.getElementById("riskBarHigh"), high, total);
    setBarWidth(document.getElementById("riskBarMedium"), medium, total);
    setBarWidth(document.getElementById("riskBarLow"), low, total);
}

function applyKpiStatus(card, status) {
    ["kpi-neutral", "kpi-danger", "kpi-warning", "kpi-success"].forEach((klass) => {
        card.classList.remove(klass);
    });

    const statusClassMap = {
        neutral: "kpi-neutral",
        danger: "kpi-danger",
        warning: "kpi-warning",
        success: "kpi-success",
    };

    card.classList.add(statusClassMap[status] || "kpi-neutral");
}

function setBarWidth(element, value, total) {
    const percent = total > 0 ? (value / total) * 100 : 0;
    element.style.width = `${Math.min(percent, 100)}%`;
}

function dataLabelNumericValue(raw) {
    if (typeof raw === "number") {
        return raw;
    }
    if (raw && typeof raw === "object") {
        if (raw.impacto_financiero !== undefined) {
            return Number(raw.impacto_financiero) || 0;
        }
        if (raw.y !== undefined) {
            return Number(raw.y) || 0;
        }
        if (raw.r !== undefined) {
            return Number(raw.r) || 0;
        }
    }
    return Number(raw) || 0;
}

function dataLabelText(chart, dataset, raw, index, datasetType) {
    if (dataset.label === "Umbral 80%") {
        return "";
    }

    const datasetLabelOptions = dataset.dashboardDataLabels || {};

    if (datasetType === "bubble") {
        return truncateText(raw?.evento || formatCurrency(raw?.impacto_financiero || 0), 18);
    }

    const value = dataLabelNumericValue(raw);
    if (datasetLabelOptions.minAbs && Math.abs(value) < datasetLabelOptions.minAbs) {
        return "";
    }
    if (typeof datasetLabelOptions.formatter === "function") {
        return datasetLabelOptions.formatter(value, raw, index);
    }

    if (datasetType === "doughnut") {
        const label = chart.data.labels?.[index] || "";
        return `${label}: ${formatNumber(value)}`;
    }

    const datasetLabel = String(dataset.label || "").toLowerCase();
    if (dataset.yAxisID === "yPercent" || datasetLabel.includes("acumulado")) {
        return `${formatDecimal(value)}%`;
    }

    if (
        dataset.yAxisID === "yMoney"
        || datasetLabel.includes("impacto")
        || datasetLabel.includes("delta")
        || datasetLabel.includes("promedio")
    ) {
        return formatCompactCurrency(value);
    }

    return formatNumber(value);
}

function dataLabelPosition(chart, element, raw, numericValue, datasetType) {
    if (!element) {
        return null;
    }

    const point = element.tooltipPosition ? element.tooltipPosition() : element;
    const { chartArea } = chart;

    if (datasetType === "doughnut") {
        return {
            x: point.x,
            y: point.y,
            align: "center",
            color: "#0f172a",
        };
    }

    if (datasetType === "bubble") {
        const radius = Number(raw?.r) || 8;
        return {
            x: point.x,
            y: point.y - radius - 9,
            align: "center",
            color: "#0f172a",
        };
    }

    const isHorizontalBar = (datasetType === "bar" || chart.config.type === "bar") && chart.options.indexAxis === "y";
    if (isHorizontalBar) {
        const positive = numericValue >= 0;
        const preferredX = point.x + (positive ? 10 : -10);
        const closeToRightEdge = preferredX > chartArea.right - 12;
        const closeToLeftEdge = preferredX < chartArea.left + 12;
        return {
            x: closeToRightEdge ? point.x - 10 : (closeToLeftEdge ? point.x + 10 : preferredX),
            y: point.y,
            align: positive ? (closeToRightEdge ? "right" : "left") : (closeToLeftEdge ? "left" : "right"),
            color: "#334155",
        };
    }

    if (datasetType === "bar" || chart.config.type === "bar") {
        const above = numericValue >= 0;
        return {
            x: point.x,
            y: point.y + (above ? -9 : 9),
            align: "center",
            color: "#334155",
        };
    }

    return {
        x: point.x,
        y: point.y - 10,
        align: "center",
        color: "#334155",
    };
}

function renderTemporal(temporal = {}) {
    const monthly = temporal.mensual || [];
    const annual = temporal.anual || [];

    upsertChart("chartEventsByMonth", {
        type: "line",
        data: {
            labels: monthly.map((item) => item.mes_label),
            datasets: [
                {
                    label: "Eventos",
                    data: monthly.map((item) => item.eventos),
                    borderColor: "#0f766e",
                    backgroundColor: "rgba(15, 118, 110, 0.12)",
                    fill: true,
                    borderWidth: 3,
                    pointHoverRadius: 5,
                },
            ],
        },
        options: {
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (context) => `${formatNumber(context.raw)} eventos`,
                    },
                },
            },
            scales: {
                x: gridlessAxis(),
                y: integerAxis("Eventos"),
            },
        },
    });

    upsertChart("chartImpactByMonth", {
        type: "line",
        data: {
            labels: monthly.map((item) => item.mes_label),
            datasets: [
                {
                    label: "Impacto",
                    data: monthly.map((item) => item.impacto_financiero),
                    borderColor: "#0284c7",
                    backgroundColor: "rgba(2, 132, 199, 0.14)",
                    fill: true,
                    borderWidth: 3,
                    pointHoverRadius: 5,
                },
            ],
        },
        options: {
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (context) => formatCurrency(context.raw),
                    },
                },
            },
            scales: {
                x: gridlessAxis(),
                y: currencyAxis("Impacto financiero"),
            },
        },
    });

    upsertChart("chartYearComparison", {
        data: {
            labels: annual.map((item) => String(item.anio)),
            datasets: [
                {
                    type: "bar",
                    label: "Impacto financiero",
                    data: annual.map((item) => item.impacto_financiero),
                    yAxisID: "yMoney",
                    backgroundColor: "rgba(15, 118, 110, 0.78)",
                    borderRadius: 12,
                    maxBarThickness: 52,
                },
                {
                    type: "line",
                    label: "Eventos",
                    data: annual.map((item) => item.eventos),
                    yAxisID: "yEvents",
                    borderColor: "#f97316",
                    backgroundColor: "#f97316",
                    borderWidth: 3,
                    fill: false,
                },
            ],
        },
        options: {
            plugins: {
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            if (context.dataset.yAxisID === "yMoney") {
                                return `${context.dataset.label}: ${formatCurrency(context.raw)}`;
                            }
                            return `${context.dataset.label}: ${formatNumber(context.raw)}`;
                        },
                    },
                },
            },
            scales: {
                x: gridlessAxis(),
                yMoney: currencyAxis("Impacto financiero"),
                yEvents: {
                    ...integerAxis("Eventos"),
                    position: "right",
                    grid: {
                        drawOnChartArea: false,
                    },
                },
            },
        },
    });
}

function renderRisks(risks = {}) {
    const breakdown = risks.por_tipo || [];
    const eventTypeBreakdown = risks.por_tipo_evento || [];
    const riskLevelBreakdown = risks.por_nivel || [];
    const topEvents = risks.top_eventos || [];
    const pareto = risks.pareto || [];
    const matrix = risks.matriz || [];

    upsertChart("chartEventsByRiskType", {
        type: "bar",
        data: {
            labels: breakdown.map((item) => item.tipo_riesgo),
            datasets: [
                {
                    label: "Eventos",
                    data: breakdown.map((item) => item.eventos),
                    backgroundColor: breakdown.map((_, index) => withOpacity(palette[index % palette.length], 0.88)),
                    borderRadius: 12,
                    maxBarThickness: 28,
                },
            ],
        },
        options: {
            indexAxis: "y",
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (context) => `${formatNumber(context.raw)} eventos`,
                    },
                },
            },
            scales: {
                x: integerAxis("Eventos"),
                y: gridlessAxis(),
            },
        },
    });

    upsertChart("chartImpactByRiskType", {
        type: "bar",
        data: {
            labels: breakdown.map((item) => item.tipo_riesgo),
            datasets: [
                {
                    label: "Impacto financiero",
                    data: breakdown.map((item) => item.impacto_financiero),
                    backgroundColor: breakdown.map((_, index) => withOpacity(palette[index % palette.length], 0.8)),
                    borderRadius: 12,
                    maxBarThickness: 28,
                },
            ],
        },
        options: {
            indexAxis: "y",
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (context) => formatCurrency(context.raw),
                    },
                },
            },
            scales: {
                x: currencyAxis("Impacto financiero"),
                y: gridlessAxis(),
            },
        },
    });

    upsertChart("chartRiskLevelDistribution", {
        type: "doughnut",
        data: {
            labels: riskLevelBreakdown.map((item) => item.nivel_label),
            datasets: [
                {
                    data: riskLevelBreakdown.map((item) => item.eventos),
                    backgroundColor: riskLevelBreakdown.map((item) => {
                        if (item.nivel_riesgo === "alto") {
                            return "rgba(220, 38, 38, 0.82)";
                        }
                        if (item.nivel_riesgo === "medio") {
                            return "rgba(217, 119, 6, 0.82)";
                        }
                        return "rgba(21, 128, 61, 0.82)";
                    }),
                    borderWidth: 0,
                    hoverOffset: 5,
                },
            ],
        },
        options: {
            cutout: "68%",
            plugins: {
                legend: {
                    position: "bottom",
                },
                tooltip: {
                    callbacks: {
                        label: (context) => `${context.label}: ${formatNumber(context.raw)} eventos`,
                    },
                },
            },
        },
    });

    upsertChart("chartEventsByEventType", {
        type: "bar",
        data: {
            labels: eventTypeBreakdown.map((item) => item.tipo_evento),
            datasets: [
                {
                    label: "Eventos",
                    data: eventTypeBreakdown.map((item) => item.eventos),
                    backgroundColor: eventTypeBreakdown.map((_, index) => withOpacity(palette[(index + 2) % palette.length], 0.82)),
                    borderRadius: 10,
                    maxBarThickness: 24,
                },
            ],
        },
        options: {
            indexAxis: "y",
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (context) => `${formatNumber(context.raw)} eventos`,
                    },
                },
            },
            scales: {
                x: integerAxis("Eventos"),
                y: compactCategoryAxis(),
            },
        },
    });

    upsertChart("chartImpactByEventType", {
        type: "bar",
        data: {
            labels: eventTypeBreakdown.map((item) => item.tipo_evento),
            datasets: [
                {
                    label: "Impacto financiero",
                    data: eventTypeBreakdown.map((item) => item.impacto_financiero),
                    backgroundColor: eventTypeBreakdown.map((_, index) => withOpacity(palette[(index + 4) % palette.length], 0.78)),
                    borderRadius: 10,
                    maxBarThickness: 24,
                },
            ],
        },
        options: {
            indexAxis: "y",
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (context) => formatCurrency(context.raw),
                    },
                },
            },
            scales: {
                x: currencyAxis("Impacto"),
                y: compactCategoryAxis(),
            },
        },
    });

    upsertChart("chartPareto", {
        data: {
            labels: pareto.map((item) => item.tipo_riesgo),
            datasets: [
                {
                    type: "bar",
                    label: "Impacto financiero",
                    data: pareto.map((item) => item.impacto_financiero),
                    backgroundColor: "rgba(2, 132, 199, 0.82)",
                    borderRadius: 12,
                    maxBarThickness: 42,
                    yAxisID: "yMoney",
                },
                {
                    type: "line",
                    label: "Acumulado",
                    data: pareto.map((item) => item.acumulado),
                    borderColor: "#dc2626",
                    backgroundColor: "#dc2626",
                    borderWidth: 3,
                    pointRadius: 3,
                    yAxisID: "yPercent",
                },
                {
                    type: "line",
                    label: "Umbral 80%",
                    data: pareto.map(() => 80),
                    borderColor: "#f97316",
                    borderWidth: 2,
                    borderDash: [6, 6],
                    pointRadius: 0,
                    yAxisID: "yPercent",
                },
            ],
        },
        options: {
            plugins: {
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            if (context.dataset.yAxisID === "yMoney") {
                                return `${context.dataset.label}: ${formatCurrency(context.raw)}`;
                            }
                            return `${context.dataset.label}: ${formatDecimal(context.raw)}%`;
                        },
                    },
                },
            },
            scales: {
                x: gridlessAxis(),
                yMoney: currencyAxis("Impacto financiero"),
                yPercent: {
                    ...percentAxis("Acumulado"),
                    position: "right",
                    min: 0,
                    max: 100,
                    grid: {
                        drawOnChartArea: false,
                    },
                },
            },
        },
    });

    renderTopEventsTable(topEvents);
    renderMatrixChart(matrix);
}

function renderEventTimeline(explorer = {}) {
    const select = document.getElementById("eventTimelineType");
    const eventTypes = explorer.event_types || [];
    const previousValue = select.value || explorer.default_type || "__all__";

    dashboardState.eventTimeline = explorer;
    select.innerHTML = [
        '<option value="__all__">Todos los tipos</option>',
        ...eventTypes.map((eventType) => {
            const escaped = escapeHtml(eventType);
            return `<option value="${escaped}">${escaped}</option>`;
        }),
    ].join("");

    const nextValue = explorer.series_by_type?.[previousValue]
        ? previousValue
        : (explorer.default_type || "__all__");
    select.value = nextValue;
    renderEventTimelineChart(nextValue);
}

function renderEventTimelineChart(eventType = "__all__") {
    const explorer = dashboardState.eventTimeline || {};
    const series = explorer.series_by_type?.[eventType] || [];
    const label = eventType === "__all__" ? "Todos los tipos" : eventType;
    const timelineArea = document.getElementById("eventTimelineArea");
    if (timelineArea) {
        timelineArea.style.minWidth = `${Math.max(series.length * 52, 760)}px`;
    }

    upsertChart("chartEventTimeline", {
        type: "bar",
        data: {
            labels: series.map((item) => splitMonthLabel(item.mes_label)),
            datasets: [
                {
                    label: `Eventos - ${label}`,
                    data: series.map((item) => item.eventos),
                    backgroundColor: "rgba(15, 118, 110, 0.78)",
                    borderRadius: 9,
                    maxBarThickness: 24,
                },
            ],
        },
        options: {
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: (items) => series[items[0]?.dataIndex]?.mes_label || "",
                        label: (context) => `${formatNumber(context.raw)} eventos`,
                    },
                },
            },
            scales: {
                x: {
                    ...gridlessAxis(),
                    ticks: {
                        ...gridlessAxis().ticks,
                        autoSkip: false,
                        maxRotation: 0,
                        minRotation: 0,
                        padding: 8,
                    },
                },
                y: integerAxis("Eventos"),
            },
        },
    });
}

function renderMatrixChart(records) {
    const maxImpact = Math.max(...records.map((item) => Number(item.impacto_financiero) || 0), 1);
    const grouped = groupBy(records, "tipo_riesgo");

    const datasets = Object.entries(grouped).map(([riskType, items], index) => ({
        label: riskType,
        data: items.map((item) => ({
            x: Number(item.x) || 0,
            y: Number(item.y) || 0,
            r: scaleBubble(item.impacto_financiero, maxImpact),
            evento: item.evento,
            tipo_evento: item.tipo_evento,
            impacto_financiero: item.impacto_financiero,
            nivel_riesgo: item.nivel_riesgo,
            fecha: item.fecha,
        })),
        backgroundColor: withOpacity(palette[index % palette.length], 0.48),
        borderColor: palette[index % palette.length],
        borderWidth: 1.6,
        hoverBorderWidth: 2,
    }));

    upsertChart("chartRiskMatrix", {
        type: "bubble",
        data: { datasets },
        options: {
            plugins: {
                tooltip: {
                    callbacks: {
                        title: (items) => items[0]?.raw?.evento || items[0]?.dataset?.label || "Evento",
                        label: (context) => {
                            const raw = context.raw || {};
                            return [
                                `Tipo de riesgo: ${context.dataset.label}`,
                                `Tipo de evento: ${raw.tipo_evento || "-"}`,
                                `Probabilidad: ${raw.x}`,
                                `Impacto: ${raw.y}`,
                                `Impacto financiero: ${formatCurrency(raw.impacto_financiero || 0)}`,
                                `Nivel de riesgo: ${capitalize(raw.nivel_riesgo || "-")}`,
                                raw.fecha ? `Fecha: ${raw.fecha}` : null,
                            ].filter(Boolean);
                        },
                    },
                },
            },
            scales: {
                x: {
                    min: 0.5,
                    max: 5.5,
                    title: { display: true, text: "Probabilidad" },
                    ticks: {
                        stepSize: 1,
                        callback: (value) => scaleLabel(value),
                    },
                    grid: {
                        color: "rgba(148, 163, 184, 0.16)",
                    },
                },
                y: {
                    min: 0.5,
                    max: 5.5,
                    title: { display: true, text: "Impacto" },
                    ticks: {
                        stepSize: 1,
                        callback: (value) => scaleLabel(value),
                    },
                    grid: {
                        color: "rgba(148, 163, 184, 0.16)",
                    },
                },
            },
        },
    });
}

function renderTopEventsTable(events) {
    const tbody = document.querySelector("#topEventsTable tbody");

    if (!events.length) {
        tbody.innerHTML = `<tr><td colspan="4" class="empty-cell">No hay eventos para mostrar con los filtros actuales.</td></tr>`;
        return;
    }

    tbody.innerHTML = events
        .map((event, index) => {
            const riskClass = riskPillClass(event.nivel_riesgo);
            return `
                <tr>
                    <td class="table-rank">${index + 1}</td>
                    <td>
                        <p class="table-title">${escapeHtml(event.evento || "Sin descripcion")}</p>
                        <span class="table-subtitle">${escapeHtml(event.tipo_evento || "Sin tipo")} | ${escapeHtml(event.fecha || "Sin fecha")}</span>
                        <span class="table-note">${escapeHtml(event.plan_accion || "Accion realizada")}</span>
                    </td>
                    <td>
                        <span class="pill-risk ${riskClass}">
                            ${escapeHtml(capitalize(event.nivel_riesgo || "bajo"))}
                        </span>
                        <span class="table-note">${escapeHtml(event.tipo_riesgo || "Sin clasificar")}</span>
                    </td>
                    <td class="amount-cell">${formatCurrency(event.impacto_financiero || 0)}</td>
                </tr>
            `;
        })
        .join("");
}

function renderEmptyDashboard(message) {
    document.getElementById("executiveSummary").textContent = message;
    document.getElementById("executiveSummary").classList.add("text-danger");
    document.getElementById("recordCounter").textContent = "0 eventos analizados";
    document.getElementById("metaGeneratedAt").textContent = "-";
    document.getElementById("metaSource").textContent = "-";
    renderActiveFilters({});
    renderDecisionPanel({
        pulso: {
            status: "neutral",
            estado: "Pendiente",
            alto_riesgo_pct: 0,
            riesgo_promedio: 0,
            narrativa: message,
        },
        acciones: {
            status: "neutral",
            cobertura_porcentaje: 0,
            eventos_con_accion: 0,
            eventos_sin_accion: 0,
            eventos_alto_riesgo_sin_accion: 0,
        },
        concentracion: {
            status: "neutral",
            participacion_porcentaje: 0,
            tipo_riesgo: null,
            impacto_financiero: 0,
            eventos: 0,
        },
        tendencia: {
            mes_actual: null,
            delta_impacto: 0,
            delta_impacto_pct: null,
            direccion_impacto: "flat",
        },
        alertas: [
            {
                status: "neutral",
                titulo: "Dashboard sin datos",
                detalle: message,
            },
        ],
        eventos_prioritarios: [],
    });
    renderYearOverYear({
        disponible: false,
        anio_actual: null,
        anio_anterior: null,
        resumen: message,
        metricas: {},
        mensual: [],
        por_tipo_riesgo: [],
        por_tipo_evento: [],
    });
    renderEventTimeline({
        event_types: [],
        default_type: "__all__",
        series_by_type: { "__all__": [] },
    });

    [
        "kpiTotalEvents",
        "kpiTotalImpact",
        "kpiAveragePerEvent",
        "kpiCostliestEvent",
        "kpiHighRiskPercent",
        "insightPrincipalRisk",
        "insightCriticalMonth",
        "insightCostliestEvent",
        "insightFrequentEventType",
    ].forEach((id) => {
        document.getElementById(id).textContent = "-";
    });

    document.getElementById("insightPrincipalRiskNote").textContent = message;
    document.getElementById("insightCriticalMonthNote").textContent = message;
    document.getElementById("insightCostliestEventNote").textContent = message;
    document.getElementById("insightFrequentEventTypeNote").textContent = message;
    document.getElementById("kpiTotalImpactNote").textContent = message;
    document.getElementById("kpiHighRiskNote").textContent = message;
    document.getElementById("kpiCostliestEventNote").textContent = message;
    document.getElementById("riskCountHigh").textContent = "0";
    document.getElementById("riskCountMedium").textContent = "0";
    document.getElementById("riskCountLow").textContent = "0";
    setBarWidth(document.getElementById("riskBarHigh"), 0, 1);
    setBarWidth(document.getElementById("riskBarMedium"), 0, 1);
    setBarWidth(document.getElementById("riskBarLow"), 0, 1);

    renderTopEventsTable([]);

    [
        "chartEventsByMonth",
        "chartImpactByMonth",
        "chartYearComparison",
        "chartYoyEvents",
        "chartYoyImpact",
        "chartYoyRiskDelta",
        "chartEventsByRiskType",
        "chartImpactByRiskType",
        "chartRiskLevelDistribution",
        "chartEventsByEventType",
        "chartImpactByEventType",
        "chartPareto",
        "chartRiskMatrix",
        "chartEventTimeline",
    ].forEach((chartId) => {
        upsertChart(chartId, {
            type: "line",
            data: {
                labels: [],
                datasets: [],
            },
            options: {
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false },
                },
                scales: {
                    x: { display: false },
                    y: { display: false },
                },
            },
        });
    });
}

function hideErrorState() {
    document.getElementById("executiveSummary").classList.remove("text-danger");
}

function upsertChart(canvasId, config) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) {
        return;
    }

    if (dashboardState.charts[canvasId]) {
        dashboardState.charts[canvasId].destroy();
    }

    dashboardState.charts[canvasId] = new Chart(canvas.getContext("2d"), config);
}

function gridlessAxis() {
    return {
        grid: {
            display: false,
            drawBorder: false,
        },
        ticks: {
            color: "#5f6c80",
            font: {
                weight: "700",
            },
        },
    };
}

function compactCategoryAxis() {
    return {
        ...gridlessAxis(),
        ticks: {
            color: "#5f6c80",
            font: {
                weight: "700",
                size: 10,
            },
            callback: function compactLabel(value) {
                const label = this.getLabelForValue(value);
                return truncateText(label, 22);
            },
        },
    };
}

function integerAxis(title) {
    return {
        beginAtZero: true,
        title: {
            display: Boolean(title),
            text: title,
        },
        ticks: {
            precision: 0,
            callback: (value) => formatNumber(value),
        },
        grid: {
            color: "rgba(148, 163, 184, 0.16)",
        },
    };
}

function currencyAxis(title) {
    return {
        beginAtZero: true,
        title: {
            display: Boolean(title),
            text: title,
        },
        ticks: {
            callback: (value) => formatCompactCurrency(value),
        },
        grid: {
            color: "rgba(148, 163, 184, 0.16)",
        },
    };
}

function deltaCurrencyAxis(title, values = []) {
    const maxAbs = Math.max(...values.map((value) => Math.abs(Number(value) || 0)), 1);
    const padded = maxAbs * 1.18;
    return {
        min: -padded,
        max: padded,
        title: {
            display: Boolean(title),
            text: title,
        },
        ticks: {
            callback: (value) => signedFormatted(value, formatCompactCurrency),
        },
        grid: {
            color: (context) => Number(context.tick.value) === 0
                ? "rgba(15, 23, 42, 0.28)"
                : "rgba(148, 163, 184, 0.16)",
            lineWidth: (context) => Number(context.tick.value) === 0 ? 1.5 : 1,
        },
    };
}

function percentAxis(title) {
    return {
        title: {
            display: Boolean(title),
            text: title,
        },
        ticks: {
            callback: (value) => `${formatDecimal(value)}%`,
        },
        grid: {
            color: "rgba(148, 163, 184, 0.16)",
        },
    };
}

function formatNumber(value) {
    return numberFormatter.format(Number(value) || 0);
}

function formatDecimal(value) {
    return decimalFormatter.format(Number(value) || 0);
}

function signedDecimal(value) {
    const numericValue = Number(value) || 0;
    return `${numericValue > 0 ? "+" : ""}${formatDecimal(numericValue)}`;
}

function formatCurrency(value) {
    return currencyFormatter.format(Number(value) || 0);
}

function formatCompactCurrency(value) {
    return compactCurrencyFormatter.format(Number(value) || 0);
}

function signedFormatted(value, formatter) {
    const numericValue = Number(value) || 0;
    return `${numericValue > 0 ? "+" : ""}${formatter(numericValue)}`;
}

function formatNullablePercent(value) {
    if (value === null || value === undefined) {
        return "Sin base previa";
    }
    return `${signedDecimal(value)}%`;
}

function showToast(message, isError = false) {
    const toast = document.getElementById("appToast");
    const body = document.getElementById("appToastBody");
    body.textContent = message;
    toast.classList.toggle("is-error", isError);
    dashboardState.toast.show();
}

function formatSource(source) {
    const sourceMap = {
        csv_url: "CSV online",
        local_csv: "CSV local",
        mysql: "MySQL",
    };
    return sourceMap[source] || "Origen externo";
}

function riskPillClass(level) {
    if (level === "alto") {
        return "pill-risk-high";
    }
    if (level === "medio") {
        return "pill-risk-medium";
    }
    return "pill-risk-low";
}

function groupBy(records, field) {
    return records.reduce((accumulator, item) => {
        const key = item[field] || "Sin clasificar";
        if (!accumulator[key]) {
            accumulator[key] = [];
        }
        accumulator[key].push(item);
        return accumulator;
    }, {});
}

function scaleBubble(value, maxValue) {
    const numericValue = Math.max(Number(value) || 0, 0);
    if (!maxValue) {
        return 8;
    }
    return Math.max(7, Math.min(28, Math.sqrt(numericValue / maxValue) * 28));
}

function scaleLabel(value) {
    const labels = {
        1: "Muy bajo",
        2: "Bajo",
        3: "Medio",
        4: "Alto",
        5: "Critico",
    };
    return labels[value] || value;
}

function truncateText(value, limit) {
    if (!value || value.length <= limit) {
        return value || "-";
    }
    return `${value.slice(0, limit - 1)}...`;
}

function splitMonthLabel(label) {
    const parts = String(label || "").split(" ");
    if (parts.length >= 2) {
        return [parts[0], parts.slice(1).join(" ")];
    }
    return label || "";
}

function withOpacity(hexColor, opacity) {
    const clean = hexColor.replace("#", "");
    const bigint = parseInt(clean, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

function capitalize(value) {
    if (!value) {
        return "";
    }
    return `${String(value).charAt(0).toUpperCase()}${String(value).slice(1)}`;
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}
