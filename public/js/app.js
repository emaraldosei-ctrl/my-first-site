(function () {
  "use strict";

  var DATA = window.HOSPITAL_DATA;
  var T = DATA.targets;
  var prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var COLORS = {
    navy: "#0b1f3a",
    navy700: "#1d3a63",
    navySoft: "rgba(11, 31, 58, 0.12)",
    teal: "#14b8a6",
    teal600: "#0d9488",
    tealSoft: "rgba(20, 184, 166, 0.16)",
    slate: "#5b6b80",
    grid: "#eaf0f6",
    amber: "#f59e0b",
    red: "#e5484d"
  };

  var state = { department: "all", period: 12, shift: "all" };
  var charts = {};

  /* ---------------- Helpers ---------------- */
  function $(id) { return document.getElementById(id); }
  function sum(arr, fn) { return arr.reduce(function (acc, item) { return acc + fn(item); }, 0); }
  function fmtInt(n) { return Math.round(n).toLocaleString("en-GB"); }
  function fmt1(n) { return (Math.round(n * 10) / 10).toFixed(1); }
  function deptName(id) {
    if (id === "all") return "All departments";
    var d = DATA.departments.find(function (x) { return x.id === id; });
    return d ? d.name : id;
  }

  function aggregateMonth(deptIds, monthIndex) {
    var rows = deptIds.map(function (id) { return DATA.records[id][monthIndex]; });
    var beds = sum(deptIds, function (id) { return DATA.departments.find(function (d) { return d.id === id; }).beds; });
    var avgPatients = sum(rows, function (r) { return r.avgPatients; });
    return {
      label: rows[0].label,
      admissions: sum(rows, function (r) { return r.admissions; }),
      discharges: sum(rows, function (r) { return r.discharges; }),
      beds: beds,
      avgPatients: avgPatients,
      occupancy: (avgPatients / beds) * 100,
      patientDays: sum(rows, function (r) { return r.patientDays; }),
      losDays: sum(rows, function (r) { return r.losDays; }),
      dayReq: sum(rows, function (r) { return r.staffing.day.required; }),
      daySch: sum(rows, function (r) { return r.staffing.day.scheduled; }),
      nightReq: sum(rows, function (r) { return r.staffing.night.required; }),
      nightSch: sum(rows, function (r) { return r.staffing.night.scheduled; }),
      outcomes: ["home", "rehab", "transfer", "ama", "deceased"].reduce(function (acc, k) {
        acc[k] = sum(rows, function (r) { return r.outcomes[k]; });
        return acc;
      }, {}),
      readmissions: sum(rows, function (r) { return r.readmissions; }),
      satisfaction: sum(rows, function (r) { return r.satisfaction * r.discharges; }) / sum(rows, function (r) { return r.discharges; }),
      falls: sum(rows, function (r) { return r.falls; }),
      hapi: sum(rows, function (r) { return r.hapi; }),
      clabsi: sum(rows, function (r) { return r.clabsi; }),
      centralLineDays: sum(rows, function (r) { return r.centralLineDays; }),
      medErrors: sum(rows, function (r) { return r.medErrors; }),
      hygiene: sum(rows, function (r) { return r.hygiene * r.patientDays; }) / sum(rows, function (r) { return r.patientDays; })
    };
  }

  function getSeries(deptId, period, offset) {
    var ids = deptId === "all" ? DATA.departments.map(function (d) { return d.id; }) : [deptId];
    var total = DATA.months.length;
    var end = total - (offset || 0);
    var start = Math.max(0, end - period);
    var out = [];
    for (var i = start; i < end; i++) out.push(aggregateMonth(ids, i));
    return out;
  }

  function scheduled(m) { return state.shift === "day" ? m.daySch : state.shift === "night" ? m.nightSch : m.daySch + m.nightSch; }
  function required(m) { return state.shift === "day" ? m.dayReq : state.shift === "night" ? m.nightReq : m.dayReq + m.nightReq; }

  function summarize(series) {
    var patientDays = sum(series, function (m) { return m.patientDays; });
    var discharges = sum(series, function (m) { return m.discharges; });
    var nursesPerShift = sum(series, function (m) { return scheduled(m); }) / (series.length * 30 * (state.shift === "all" ? 2 : 1));
    var avgPatients = sum(series, function (m) { return m.avgPatients; }) / series.length;
    return {
      admissions: sum(series, function (m) { return m.admissions; }),
      occupancy: sum(series, function (m) { return m.occupancy; }) / series.length,
      ratio: avgPatients / nursesPerShift,
      los: sum(series, function (m) { return m.losDays; }) / discharges,
      readmit: (sum(series, function (m) { return m.readmissions; }) / discharges) * 100,
      satisfaction: sum(series, function (m) { return m.satisfaction * m.discharges; }) / discharges,
      fillRate: (sum(series, scheduled) / sum(series, required)) * 100,
      falls: (sum(series, function (m) { return m.falls; }) / patientDays) * 1000,
      hapi: (sum(series, function (m) { return m.hapi; }) / patientDays) * 1000,
      clabsi: (sum(series, function (m) { return m.clabsi; }) / Math.max(1, sum(series, function (m) { return m.centralLineDays; }))) * 1000,
      medErrors: (sum(series, function (m) { return m.medErrors; }) / patientDays) * 1000,
      hygiene: sum(series, function (m) { return m.hygiene * m.patientDays; }) / patientDays
    };
  }

  /* ---------------- Count-up animation ---------------- */
  function animateValue(el, to, formatter) {
    if (!el) return;
    var from = parseFloat(el.dataset.value || "0");
    el.dataset.value = String(to);
    if (prefersReducedMotion || from === to) { el.textContent = formatter(to); return; }
    var duration = 700;
    var startTime = null;
    function step(ts) {
      if (!startTime) startTime = ts;
      var p = Math.min(1, (ts - startTime) / duration);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = formatter(from + (to - from) * eased);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function setDelta(el, current, previous, opts) {
    if (!el) return;
    if (!previous) { el.textContent = ""; return; }
    var diff = opts.percent ? ((current - previous) / previous) * 100 : current - previous;
    var isUp = diff >= 0;
    var good = opts.higherIsBetter ? isUp : !isUp;
    if (Math.abs(diff) < 0.05) { el.className = "kpi-delta"; el.textContent = "\u2192 Stable vs prior " + state.period + " mo"; return; }
    el.className = "kpi-delta " + (isUp ? "up-" : "down-") + (good ? "good" : "bad");
    var arrow = isUp ? "\u2191" : "\u2193";
    var value = opts.percent ? fmt1(Math.abs(diff)) + "%" : fmt1(Math.abs(diff)) + (opts.unit || "");
    el.textContent = arrow + " " + value + " vs prior " + state.period + " mo";
  }

  /* ---------------- Chart setup ---------------- */
  function setupChartDefaults() {
    Chart.defaults.font.family = '"Inter", system-ui, sans-serif';
    Chart.defaults.font.size = 12;
    Chart.defaults.color = COLORS.slate;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.boxWidth = 8;
    Chart.defaults.plugins.legend.labels.boxHeight = 8;
    Chart.defaults.plugins.tooltip.backgroundColor = COLORS.navy;
    Chart.defaults.plugins.tooltip.padding = 12;
    Chart.defaults.plugins.tooltip.cornerRadius = 10;
    Chart.defaults.plugins.tooltip.titleFont = { weight: "600" };
    Chart.defaults.maintainAspectRatio = false;
    if (prefersReducedMotion) Chart.defaults.animation = false;
  }

  var thresholdPlugin = {
    id: "threshold",
    afterDatasetsDraw: function (chart, _args, opts) {
      if (opts.value == null) return;
      var ctx = chart.ctx;
      var area = chart.chartArea;
      var scale = chart.scales[opts.axis || "y"];
      var pos = scale.getPixelForValue(opts.value);
      ctx.save();
      ctx.strokeStyle = opts.color || COLORS.amber;
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (opts.axis === "x") { ctx.moveTo(pos, area.top); ctx.lineTo(pos, area.bottom); }
      else { ctx.moveTo(area.left, pos); ctx.lineTo(area.right, pos); }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = opts.color || COLORS.amber;
      ctx.font = '600 11px "Inter", sans-serif';
      if (opts.axis === "x") { ctx.textAlign = "right"; ctx.fillText(opts.label, pos - 6, area.top + 10); }
      else { ctx.textAlign = "right"; ctx.fillText(opts.label, area.right, pos - 6); }
      ctx.restore();
    }
  };

  function gradient(ctx, color) {
    var chart = ctx.chart;
    if (!chart.chartArea) return color;
    var g = chart.ctx.createLinearGradient(0, chart.chartArea.top, 0, chart.chartArea.bottom);
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(20, 184, 166, 0)");
    return g;
  }

  function baseScales(yOpts) {
    return {
      x: { grid: { display: false }, border: { display: false } },
      y: Object.assign({ grid: { color: COLORS.grid }, border: { display: false }, beginAtZero: false }, yOpts || {})
    };
  }

  function createCharts() {
    charts.heroSpark = new Chart($("heroSpark"), {
      type: "line",
      data: { labels: [], datasets: [{ data: [], borderColor: COLORS.teal, borderWidth: 2.5, tension: 0.4, pointRadius: 0, fill: true, backgroundColor: function (ctx) { return gradient(ctx, "rgba(20, 184, 166, 0.35)"); } }] },
      options: { plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { x: { display: false }, y: { display: false } } }
    });

    charts.admissions = new Chart($("admissionsChart"), {
      type: "line",
      data: {
        labels: [],
        datasets: [
          { label: "Admissions", data: [], borderColor: COLORS.teal, backgroundColor: function (ctx) { return gradient(ctx, "rgba(20, 184, 166, 0.25)"); }, fill: true, tension: 0.35, borderWidth: 2.5, pointRadius: 3, pointHoverRadius: 6, pointBackgroundColor: "#fff", pointBorderWidth: 2 },
          { label: "Discharges", data: [], borderColor: COLORS.navy, backgroundColor: COLORS.navy, borderDash: [5, 4], tension: 0.35, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5 }
        ]
      },
      options: { interaction: { mode: "index", intersect: false }, plugins: { legend: { position: "top", align: "end" } }, scales: baseScales() }
    });

    charts.outcomes = new Chart($("outcomesChart"), {
      type: "doughnut",
      data: {
        labels: ["Discharged home", "Rehab / care facility", "Transferred", "Left against advice", "Deceased"],
        datasets: [{ data: [], backgroundColor: [COLORS.teal, COLORS.navy700, "#7dd3c8", COLORS.amber, "#94a3b8"], borderColor: "#fff", borderWidth: 3, hoverOffset: 8 }]
      },
      options: {
        cutout: "66%",
        plugins: {
          legend: { position: "bottom", labels: { padding: 14 } },
          tooltip: { callbacks: { label: function (c) { var total = c.dataset.data.reduce(function (a, b) { return a + b; }, 0); return " " + c.label + ": " + fmtInt(c.parsed) + " (" + fmt1((c.parsed / total) * 100) + "%)"; } } }
        }
      }
    });

    charts.occupancy = new Chart($("occupancyChart"), {
      type: "bar",
      data: { labels: [], datasets: [{ label: "Occupancy %", data: [], backgroundColor: [], borderRadius: 6, borderSkipped: false, barThickness: 18 }] },
      options: {
        indexAxis: "y",
        plugins: {
          legend: { display: false },
          threshold: { value: T.occupancy, axis: "x", label: "85% target", color: COLORS.amber },
          tooltip: { callbacks: { label: function (c) { return " " + fmt1(c.parsed.x) + "% occupied"; } } }
        },
        scales: {
          x: { min: 40, max: 100, grid: { color: COLORS.grid }, border: { display: false }, ticks: { callback: function (v) { return v + "%"; } } },
          y: { grid: { display: false }, border: { display: false } }
        }
      },
      plugins: [thresholdPlugin]
    });

    charts.staffing = new Chart($("staffingChart"), {
      data: {
        labels: [],
        datasets: [
          { type: "bar", label: "Required RN shifts", data: [], backgroundColor: COLORS.navySoft, borderRadius: 6, borderSkipped: false, order: 2 },
          { type: "bar", label: "Scheduled RN shifts", data: [], backgroundColor: COLORS.navy, borderRadius: 6, borderSkipped: false, order: 3 },
          { type: "line", label: "Fill rate %", data: [], yAxisID: "y1", borderColor: COLORS.teal, backgroundColor: COLORS.teal, tension: 0.35, borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: "#fff", pointBorderWidth: 2, order: 1 }
        ]
      },
      options: {
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { position: "top", align: "end" } },
        scales: {
          x: { grid: { display: false }, border: { display: false } },
          y: { grid: { color: COLORS.grid }, border: { display: false }, beginAtZero: true, title: { display: true, text: "Shifts" } },
          y1: { position: "right", min: 75, max: 105, grid: { display: false }, border: { display: false }, ticks: { callback: function (v) { return v + "%"; } } }
        }
      }
    });

    charts.harm = new Chart($("harmChart"), {
      type: "line",
      data: {
        labels: [],
        datasets: [
          { label: "Falls", data: [], borderColor: COLORS.navy, backgroundColor: COLORS.navy, tension: 0.35, borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: "#fff", pointBorderWidth: 2 },
          { label: "Pressure injuries (HAPI)", data: [], borderColor: COLORS.teal, backgroundColor: COLORS.teal, tension: 0.35, borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: "#fff", pointBorderWidth: 2 }
        ]
      },
      options: {
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { position: "top", align: "end" }, tooltip: { callbacks: { label: function (c) { return " " + c.dataset.label + ": " + fmt1(c.parsed.y) + " / 1,000 pt days"; } } } },
        scales: baseScales({ beginAtZero: true })
      }
    });

    charts.hygiene = new Chart($("hygieneChart"), {
      type: "line",
      data: {
        labels: [],
        datasets: [{ label: "Compliance %", data: [], borderColor: COLORS.teal, backgroundColor: function (ctx) { return gradient(ctx, "rgba(20, 184, 166, 0.25)"); }, fill: true, tension: 0.35, borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: "#fff", pointBorderWidth: 2 }]
      },
      options: {
        plugins: {
          legend: { display: false },
          threshold: { value: T.hygiene, axis: "y", label: "95% target", color: COLORS.amber },
          tooltip: { callbacks: { label: function (c) { return " " + fmt1(c.parsed.y) + "% compliant"; } } }
        },
        scales: baseScales({ min: 80, max: 100, ticks: { callback: function (v) { return v + "%"; } } })
      },
      plugins: [thresholdPlugin]
    });
  }

  /* ---------------- Rendering ---------------- */
  function renderHero() {
    var series = getSeries("all", 12);
    var s = summarize(series);
    var fill = (sum(series, function (m) { return m.daySch + m.nightSch; }) / sum(series, function (m) { return m.dayReq + m.nightReq; })) * 100;
    animateValue($("hero-admissions"), s.admissions, fmtInt);
    animateValue($("hero-occupancy"), s.occupancy, function (v) { return fmt1(v) + "%"; });
    animateValue($("hero-staffing"), fill, function (v) { return fmt1(v) + "%"; });
    animateValue($("hero-readmit"), s.readmit, function (v) { return fmt1(v) + "%"; });
    charts.heroSpark.data.labels = series.map(function (m) { return m.label; });
    charts.heroSpark.data.datasets[0].data = series.map(function (m) { return m.admissions; });
    charts.heroSpark.update();
  }

  function renderKpis(cur, prev) {
    animateValue($("kpi-admissions"), cur.admissions, fmtInt);
    setDelta($("kpi-admissions-delta"), cur.admissions, prev && prev.admissions, { percent: true, higherIsBetter: true });

    animateValue($("kpi-occupancy"), cur.occupancy, function (v) { return fmt1(v) + "%"; });
    var bar = $("kpi-occupancy-bar");
    bar.style.width = Math.min(100, cur.occupancy) + "%";
    bar.classList.toggle("is-high", cur.occupancy > T.occupancy);
    setDelta($("kpi-occupancy-delta"), cur.occupancy, prev && prev.occupancy, { unit: " pts", higherIsBetter: false });

    animateValue($("kpi-ratio"), cur.ratio, function (v) { return "1 : " + fmt1(v); });
    setDelta($("kpi-ratio-delta"), cur.ratio, prev && prev.ratio, { unit: "", higherIsBetter: false });

    animateValue($("kpi-los"), cur.los, function (v) { return fmt1(v) + " days"; });
    setDelta($("kpi-los-delta"), cur.los, prev && prev.los, { unit: " d", higherIsBetter: false });

    animateValue($("kpi-readmit"), cur.readmit, function (v) { return fmt1(v) + "%"; });
    setDelta($("kpi-readmit-delta"), cur.readmit, prev && prev.readmit, { unit: " pts", higherIsBetter: false });

    animateValue($("kpi-satisfaction"), cur.satisfaction, function (v) { return fmt1(v) + "%"; });
    setDelta($("kpi-satisfaction-delta"), cur.satisfaction, prev && prev.satisfaction, { unit: " pts", higherIsBetter: true });
  }

  function renderCharts(series) {
    var labels = series.map(function (m) { return m.label; });

    charts.admissions.data.labels = labels;
    charts.admissions.data.datasets[0].data = series.map(function (m) { return m.admissions; });
    charts.admissions.data.datasets[1].data = series.map(function (m) { return m.discharges; });
    charts.admissions.update();

    var outcomeKeys = ["home", "rehab", "transfer", "ama", "deceased"];
    charts.outcomes.data.datasets[0].data = outcomeKeys.map(function (k) { return sum(series, function (m) { return m.outcomes[k]; }); });
    charts.outcomes.update();

    var occ = DATA.departments.map(function (d) {
      var s = getSeries(d.id, state.period);
      return { name: d.name, id: d.id, value: sum(s, function (m) { return m.occupancy; }) / s.length };
    });
    charts.occupancy.data.labels = occ.map(function (o) { return o.name; });
    charts.occupancy.data.datasets[0].data = occ.map(function (o) { return o.value; });
    charts.occupancy.data.datasets[0].backgroundColor = occ.map(function (o) {
      var dim = state.department !== "all" && state.department !== o.id;
      if (o.value > T.occupancy) return dim ? "rgba(245, 158, 11, 0.3)" : COLORS.amber;
      return dim ? "rgba(20, 184, 166, 0.25)" : COLORS.teal;
    });
    charts.occupancy.update();

    charts.staffing.data.labels = labels;
    charts.staffing.data.datasets[0].data = series.map(required);
    charts.staffing.data.datasets[1].data = series.map(scheduled);
    charts.staffing.data.datasets[2].data = series.map(function (m) { return (scheduled(m) / required(m)) * 100; });
    charts.staffing.update();

    charts.harm.data.labels = labels;
    charts.harm.data.datasets[0].data = series.map(function (m) { return (m.falls / m.patientDays) * 1000; });
    charts.harm.data.datasets[1].data = series.map(function (m) { return (m.hapi / m.patientDays) * 1000; });
    charts.harm.update();

    charts.hygiene.data.labels = labels;
    charts.hygiene.data.datasets[0].data = series.map(function (m) { return m.hygiene; });
    charts.hygiene.update();
  }

  function renderTable() {
    var body = $("dept-table-body");
    body.innerHTML = "";
    DATA.departments.forEach(function (d) {
      var s = summarize(getSeries(d.id, state.period));
      var status = s.occupancy > 88 || s.fillRate < 90 ? ["alert", "Action needed"] : s.occupancy > T.occupancy || s.fillRate < 93 ? ["watch", "Monitor"] : ["ok", "On track"];
      var tr = document.createElement("tr");
      if (state.department === d.id) tr.className = "is-selected";
      tr.innerHTML =
        '<td class="dept-name">' + d.name + "</td>" +
        "<td>" + d.beds + "</td>" +
        "<td>" + fmtInt(s.admissions) + "</td>" +
        "<td>" + fmt1(s.occupancy) + "%</td>" +
        "<td>" + fmt1(s.los) + " d</td>" +
        "<td>" + fmt1(s.fillRate) + "%</td>" +
        '<td><span class="status-pill status-' + status[0] + '">' + status[1] + "</span></td>";
      body.appendChild(tr);
    });
  }

  function renderSafety(cur) {
    var items = [
      { label: "Falls", value: fmt1(cur.falls), unit: "per 1,000 patient days", ok: cur.falls <= T.falls, target: "Target \u2264 " + fmt1(T.falls) },
      { label: "Pressure injuries", value: fmt1(cur.hapi), unit: "HAPI per 1,000 patient days", ok: cur.hapi <= T.hapi, target: "Target \u2264 " + fmt1(T.hapi) },
      { label: "CLABSI", value: fmt1(cur.clabsi), unit: "per 1,000 central-line days", ok: cur.clabsi <= T.clabsi, target: "Target \u2264 " + fmt1(T.clabsi) },
      { label: "Medication errors", value: fmt1(cur.medErrors), unit: "per 1,000 patient days", ok: cur.medErrors <= T.medErrors, target: "Target \u2264 " + fmt1(T.medErrors) },
      { label: "Hand hygiene", value: fmt1(cur.hygiene) + "%", unit: "observed compliance", ok: cur.hygiene >= T.hygiene, target: "Target \u2265 " + T.hygiene + "%" }
    ];
    $("safety-kpis").innerHTML = items.map(function (i) {
      return '<article class="safety-card' + (i.ok ? "" : " is-warn") + '">' +
        '<p class="safety-label">' + i.label + "</p>" +
        '<p class="safety-value">' + i.value + "</p>" +
        '<p class="safety-unit">' + i.unit + "</p>" +
        '<p class="safety-target ' + (i.ok ? "ok" : "warn") + '">' + (i.ok ? "\u2713 Meeting target" : "\u25B2 Above target") + " &middot; " + i.target + "</p>" +
        "</article>";
    }).join("");
  }

  function renderInsights(series, cur) {
    var insights = [];
    var name = deptName(state.department);

    if (state.department === "all") {
      var ranked = DATA.departments.map(function (d) {
        return { name: d.name, s: summarize(getSeries(d.id, state.period)) };
      }).sort(function (a, b) { return b.s.occupancy - a.s.occupancy; });
      var top = ranked[0];
      insights.push({
        type: top.s.occupancy > T.occupancy ? "warning" : "positive",
        title: top.name + " is the most capacity-constrained unit",
        text: "Average occupancy of " + fmt1(top.s.occupancy) + "% " + (top.s.occupancy > T.occupancy ? "exceeds the 85% safe-capacity threshold, increasing risk of delayed admissions and corridor care." : "remains within the 85% safe-capacity threshold.")
      });
    } else {
      insights.push({
        type: cur.occupancy > T.occupancy ? "warning" : "positive",
        title: name + " occupancy at " + fmt1(cur.occupancy) + "%",
        text: cur.occupancy > T.occupancy ? "Running above the 85% threshold. Consider early discharge planning and flexible bed management." : "Within the 85% safe-capacity threshold, leaving headroom for surges."
      });
    }

    var lowFill = series.reduce(function (min, m) { var f = (scheduled(m) / required(m)) * 100; return f < min.f ? { f: f, label: m.label } : min; }, { f: Infinity, label: "" });
    if (series.length >= 3) {
      var low = series.filter(function (m) { return scheduled(m) / required(m) < 0.93; });
      var ok = series.filter(function (m) { return scheduled(m) / required(m) >= 0.93; });
      var rate = function (arr) { return arr.length ? (sum(arr, function (m) { return m.falls; }) / sum(arr, function (m) { return m.patientDays; })) * 1000 : null; };
      var lowRate = rate(low), okRate = rate(ok);
      if (lowRate != null && okRate != null && okRate > 0 && lowRate > okRate) {
        insights.push({
          type: "warning",
          title: "Lower staffing linked to more falls",
          text: "Months with RN fill rate below 93% averaged " + fmt1(lowRate) + " falls per 1,000 patient days vs " + fmt1(okRate) + " when staffing was adequate (" + fmt1(((lowRate - okRate) / okRate) * 100) + "% higher)."
        });
      } else {
        insights.push({
          type: lowFill.f < 93 ? "warning" : "positive",
          title: "Lowest staffing fill rate: " + fmt1(lowFill.f) + "% in " + lowFill.label,
          text: lowFill.f < 93 ? "Review agency, float pool and overtime planning ahead of similar periods." : "Staffing remained close to required levels across the selected period."
        });
      }
    }

    if (series.length >= 6) {
      var recent = series.slice(-3), prior = series.slice(-6, -3);
      var r = (sum(recent, function (m) { return m.falls; }) / sum(recent, function (m) { return m.patientDays; })) * 1000;
      var p = (sum(prior, function (m) { return m.falls; }) / sum(prior, function (m) { return m.patientDays; })) * 1000;
      if (p > 0) {
        var change = ((r - p) / p) * 100;
        insights.push({
          type: change <= 0 ? "positive" : "warning",
          title: "Falls " + (change <= 0 ? "down " : "up ") + fmt1(Math.abs(change)) + "% over the last quarter",
          text: change <= 0 ? "Consistent with the purposeful rounding bundle introduced this year. Continue run-chart monitoring to confirm sustained improvement." : "Investigate contributing factors such as acuity mix, night-shift staffing and bed-exit alarm use."
        });
      }
    }

    var hygieneTrend = series[series.length - 1].hygiene - series[0].hygiene;
    insights.push({
      type: cur.hygiene >= T.hygiene ? "positive" : "info",
      title: "Hand hygiene " + (hygieneTrend >= 0 ? "improved " : "declined ") + fmt1(Math.abs(hygieneTrend)) + " pts",
      text: "Current period compliance is " + fmt1(cur.hygiene) + "% against a 95% target. " + (cur.hygiene >= T.hygiene ? "Target achieved \u2014 focus on sustaining audits." : "Targeted coaching and visible feedback could close the remaining gap.")
    });

    var peak = series.reduce(function (a, b) { return b.admissions > a.admissions ? b : a; });
    insights.push({
      type: "info",
      title: "Peak demand in " + peak.label,
      text: fmtInt(peak.admissions) + " admissions were recorded. A forecasting model could flag similar seasonal surges early so staffing can be planned in advance."
    });

    var iconFor = { positive: "\u2713", warning: "!", info: "i" };
    $("insight-list").innerHTML = insights.map(function (i, idx) {
      return '<li class="insight ' + i.type + '" style="animation-delay:' + idx * 60 + 'ms">' +
        '<span class="insight-icon" aria-hidden="true">' + iconFor[i.type] + "</span>" +
        "<div><strong>" + i.title + "</strong><p>" + i.text + "</p></div></li>";
    }).join("");
  }

  function render() {
    var series = getSeries(state.department, state.period);
    var prevSeries = getSeries(state.department, state.period, state.period);
    var cur = summarize(series);
    var prev = prevSeries.length === state.period ? summarize(prevSeries) : null;

    renderKpis(cur, prev);
    renderCharts(series);
    renderTable();
    renderSafety(cur);
    renderInsights(series, cur);

    $("filter-status").textContent = "Showing " + deptName(state.department) + " for the last " + state.period + " months.";
  }

  /* ---------------- Filters ---------------- */
  function setupFilters() {
    var select = $("filter-department");
    var opts = [{ id: "all", name: "All departments" }].concat(DATA.departments);
    select.innerHTML = opts.map(function (d) { return '<option value="' + d.id + '">' + d.name + "</option>"; }).join("");

    select.addEventListener("change", function (e) { state.department = e.target.value; render(); });
    $("filter-shift").addEventListener("change", function (e) { state.shift = e.target.value; render(); });
    document.querySelectorAll('input[name="period"]').forEach(function (r) {
      r.addEventListener("change", function (e) { state.period = parseInt(e.target.value, 10); render(); });
    });
    $("filters-reset").addEventListener("click", function () {
      state = { department: "all", period: 12, shift: "all" };
      select.value = "all";
      $("filter-shift").value = "all";
      $("period-12").checked = true;
      render();
    });
  }

  /* ---------------- Navigation & interactions ---------------- */
  function setupNav() {
    var toggle = document.querySelector(".nav-toggle");
    var menu = $("nav-menu");
    var header = document.querySelector(".site-header");

    function closeMenu() { toggle.setAttribute("aria-expanded", "false"); menu.classList.remove("is-open"); }
    toggle.addEventListener("click", function () {
      var open = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!open));
      menu.classList.toggle("is-open", !open);
    });
    menu.querySelectorAll("a").forEach(function (a) { a.addEventListener("click", closeMenu); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeMenu(); });

    function onScroll() { header.classList.toggle("is-scrolled", window.scrollY > 8); }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    var links = document.querySelectorAll(".nav-link");
    var sections = ["home", "dashboard", "safety", "about"].map($);
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          links.forEach(function (l) {
            var active = l.getAttribute("href") === "#" + entry.target.id;
            l.classList.toggle("is-active", active);
            if (active) l.setAttribute("aria-current", "true"); else l.removeAttribute("aria-current");
          });
        });
      }, { rootMargin: "-45% 0px -50% 0px" });
      sections.forEach(function (s) { if (s) io.observe(s); });
    }
  }

  function setupReveal() {
    var els = document.querySelectorAll(".reveal");
    if (prefersReducedMotion || !("IntersectionObserver" in window)) {
      els.forEach(function (el) { el.classList.add("is-visible"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { entry.target.classList.add("is-visible"); io.unobserve(entry.target); }
      });
    }, { threshold: 0.08, rootMargin: "0px 0px -40px 0px" });
    els.forEach(function (el) { io.observe(el); });
  }

  function init() {
    $("year").textContent = new Date().getFullYear();
    setupNav();
    setupReveal();
    if (typeof Chart === "undefined") return;
    setupChartDefaults();
    createCharts();
    setupFilters();
    renderHero();
    render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
