const riskDetailConfig = window.riskDetailConfig || {};
const detailLocale = riskDetailConfig.locale || document.body.dataset.dashboardLocale || "es-AR";
const detailCurrency = riskDetailConfig.currency || document.body.dataset.dashboardCurrency || "ARS";

const detailNumberFormatter = new Intl.NumberFormat(detailLocale, {
    maximumFractionDigits: 0,
});
const detailDecimalFormatter = new Intl.NumberFormat(detailLocale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
});
const detailCurrencyFormatter = new Intl.NumberFormat(detailLocale, {
    style: "currency",
    currency: detailCurrency,
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: 0,
});

const detailState = {
    toast: null,
};

document.addEventListener("DOMContentLoaded", () => {
    detailState.toast = new bootstrap.Toast(document.getElementById("appToast"), {
        delay: 3200,
    });

    bindRiskDetailEvents();
    loadRiskDetail();
});

function bindRiskDetailEvents() {
    document.getElementById("btnApplyDetailFilters").addEventListener("click", () => loadRiskDetail());
    document.getElementById("btnClearDetailFilters").addEventListener("click", clearRiskDetailFilters);

    ["detailFilterYear", "detailFilterEventType", "detailFilterRiskType"].forEach((id) => {
        document.getElementById(id).addEventListener("change", () => loadRiskDetail());
    });
}

async function loadRiskDetail({ silent = false } = {}) {
    try {
        setDetailLoading(true);
        const response = await fetch(urlWithParams(riskDetailConfig.apiUrl, getCurrentDetailParams()), {
            cache: "no-store",
        });
        if (!response.ok) {
            throw new Error("La API devolvio un error.");
        }

        const payload = await response.json();
        renderDetailFilterOptions(payload.available_filters, payload.filters);
        renderDetailSummary(payload.resumen || {});
        renderDetailMeta(payload.meta || {});
        renderRiskDetailTable(payload.detalle || []);
        updateDetailDownloadLink();

        if (!silent) {
            showDetailToast("Detalle actualizado.");
        }
    } catch (error) {
        console.error(error);
        renderRiskDetailTable([]);
        showDetailToast("No fue posible cargar el detalle.", true);
    } finally {
        setDetailLoading(false);
    }
}

function clearRiskDetailFilters() {
    document.getElementById("detailFilterYear").value = "all";
    document.getElementById("detailFilterEventType").value = "all";
    document.getElementById("detailFilterRiskType").value = "all";
    loadRiskDetail();
}

function getCurrentDetailParams() {
    const params = new URLSearchParams();
    const year = document.getElementById("detailFilterYear").value;
    const eventType = document.getElementById("detailFilterEventType").value;
    const riskType = document.getElementById("detailFilterRiskType").value;

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

function updateDetailDownloadLink() {
    const link = document.getElementById("btnDownloadRiskDetail");
    link.href = urlWithParams(riskDetailConfig.downloadUrl, getCurrentDetailParams());
}

function renderDetailFilterOptions(options = {}, selected = {}) {
    updateDetailSelect(
        document.getElementById("detailFilterYear"),
        options.years || [],
        selected.year || "all",
        "Todos"
    );
    updateDetailSelect(
        document.getElementById("detailFilterEventType"),
        options.event_types || [],
        selected.event_type || "all",
        "Todos"
    );
    updateDetailSelect(
        document.getElementById("detailFilterRiskType"),
        options.risk_types || [],
        selected.risk_type || "all",
        "Todos"
    );
    renderDetailActiveFilters(selected);
}

function updateDetailSelect(select, values, selectedValue, defaultLabel) {
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

function renderDetailActiveFilters(selected = {}) {
    const chips = [];
    if (selected.year && selected.year !== "all") {
        chips.push(`Anio: ${escapeHtml(selected.year)}`);
    }
    if (selected.event_type && selected.event_type !== "all") {
        chips.push(`Evento: ${escapeHtml(selected.event_type)}`);
    }
    if (selected.risk_type && selected.risk_type !== "all") {
        chips.push(`Riesgo: ${escapeHtml(selected.risk_type)}`);
    }

    document.getElementById("detailActiveFilterChips").innerHTML = chips.length
        ? chips.map((chip) => `<span class="filter-chip">${chip}</span>`).join("")
        : '<span class="filter-chip">Todos los datos</span>';
}

function renderDetailSummary(summary = {}) {
    document.getElementById("detailTotalEvents").textContent = formatNumber(summary.total_eventos || 0);
    document.getElementById("detailTotalImpact").textContent = formatCurrency(summary.impacto_financiero_total || 0);
    document.getElementById("detailHighRiskEvents").textContent = formatNumber(summary.eventos_alto_riesgo || 0);
    document.getElementById("detailAverageRisk").textContent = `${formatDecimal(summary.riesgo_promedio || 0)}/25`;
}

function renderDetailMeta(meta = {}) {
    document.getElementById("detailGeneratedAt").textContent = meta.generated_at
        ? `Actualizado ${meta.generated_at}`
        : "Sin actualizar";
}

function renderRiskDetailTable(events) {
    const tbody = document.querySelector("#riskDetailTable tbody");
    document.getElementById("detailRecordCounter").textContent = `${formatNumber(events.length)} registros`;

    if (!events.length) {
        tbody.innerHTML = `<tr><td colspan="10" class="empty-cell">No hay riesgos externos para mostrar con los filtros actuales.</td></tr>`;
        return;
    }

    tbody.innerHTML = events.map(renderRiskDetailRow).join("");
}

function renderRiskDetailRow(event) {
    const riskClass = riskPillClass(event.nivel_riesgo);
    const level = capitalize(event.nivel_riesgo || "bajo");

    return `
        <tr>
            <td data-label="#" class="table-rank">${formatNumber(event.prioridad || 0)}</td>
            <td data-label="Fecha" class="detail-date-cell">
                <strong>${escapeHtml(event.fecha || "Sin fecha")}</strong>
                <span class="table-note">${escapeHtml(event.mes_label || "Sin mes")}</span>
            </td>
            <td data-label="Evento" class="risk-detail-event">
                <p class="table-title">${escapeHtml(event.evento || "Sin descripcion")}</p>
            </td>
            <td data-label="Tipo evento">${escapeHtml(event.tipo_evento || "Sin tipo")}</td>
            <td data-label="Tipo riesgo">${escapeHtml(event.tipo_riesgo || "Sin clasificar")}</td>
            <td data-label="Nivel">
                <span class="pill-risk ${riskClass}">${escapeHtml(level)}</span>
                <span class="table-note">Score ${formatNumber(event.riesgo_score || 0)}/25</span>
            </td>
            <td data-label="Impacto">
                <strong class="detail-score">${escapeHtml(event.impacto_cualitativo || "Medio")}</strong>
                <span class="table-note">${formatNumber(event.impacto_score || 0)}/5</span>
            </td>
            <td data-label="Probabilidad">
                <strong class="detail-score">${escapeHtml(event.probabilidad || "Media")}</strong>
                <span class="table-note">${formatNumber(event.probabilidad_score || 0)}/5</span>
            </td>
            <td data-label="Impacto financiero" class="amount-cell">${formatCurrency(event.impacto_financiero || 0)}</td>
            <td data-label="Plan de accion" class="risk-detail-plan">${escapeHtml(event.plan_accion || "Accion realizada")}</td>
        </tr>
    `;
}

function setDetailLoading(isLoading) {
    [
        "btnApplyDetailFilters",
        "btnClearDetailFilters",
        "detailFilterYear",
        "detailFilterEventType",
        "detailFilterRiskType",
    ].forEach((id) => {
        document.getElementById(id).disabled = isLoading;
    });

    const download = document.getElementById("btnDownloadRiskDetail");
    download.classList.toggle("disabled", isLoading);
    download.setAttribute("aria-disabled", String(isLoading));
    document.querySelector("main").classList.toggle("is-loading", isLoading);
}

function showDetailToast(message, isError = false) {
    const toast = document.getElementById("appToast");
    const body = document.getElementById("appToastBody");
    body.textContent = message;
    toast.classList.toggle("is-error", isError);
    detailState.toast.show();
}

function formatNumber(value) {
    return detailNumberFormatter.format(Number(value) || 0);
}

function formatDecimal(value) {
    return detailDecimalFormatter.format(Number(value) || 0);
}

function formatCurrency(value) {
    return detailCurrencyFormatter.format(Number(value) || 0);
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
