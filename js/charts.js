(function () {
  "use strict";

  let charts = {};

  const colors = {
    temp: "#d94f45",
    spo2: "#168a72",
    sys: "#5d63c8",
    dia: "#8c6ad8",
    pulse: "#d36b2c",
    resp: "#2878a8",
    pain: "#b04078",
    water: "#2477a8",
    urine: "#8a6d1d"
  };

  function makeChart(canvasId, label, datasets) {
    const ctx = document.getElementById(canvasId);
    if (!ctx || !window.Chart) {
      return null;
    }
    return new Chart(ctx, {
      type: "line",
      data: {
        labels: [],
        datasets: datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: datasets.length > 1 },
          tooltip: { callbacks: { title: function (items) { return items[0].label; } } },
          title: { display: true, text: label, align: "start" }
        },
        scales: {
          x: { ticks: { maxRotation: 0, autoSkip: true } },
          y: { beginAtZero: false }
        }
      }
    });
  }

  function dataset(label, color) {
    return {
      label: label,
      data: [],
      borderColor: color,
      backgroundColor: color + "22",
      borderWidth: 2,
      pointRadius: 3,
      tension: 0.25,
      spanGaps: true
    };
  }

  function init() {
    charts.temperature = makeChart("temperatureChart", "체온", [dataset("체온", colors.temp)]);
    charts.spo2 = makeChart("spo2Chart", "산소포화도", [dataset("산소포화도", colors.spo2)]);
    charts.bp = makeChart("bpChart", "혈압", [dataset("수축기", colors.sys), dataset("이완기", colors.dia)]);
    charts.pulse = makeChart("pulseChart", "심박수", [dataset("심박수", colors.pulse)]);
    charts.resp = makeChart("respChart", "호흡수", [dataset("호흡수", colors.resp)]);
    charts.pain = makeChart("painChart", "통증 점수", [dataset("통증 점수", colors.pain)]);
    charts.waterIntake = makeChart("waterIntakeChart", "물 섭취량", [dataset("물 섭취량 (mL)", colors.water)]);
    charts.urineOutput = makeChart("urineOutputChart", "소변량", [dataset("소변량 (mL)", colors.urine)]);
  }

  function cutoffFor(range) {
    const now = Date.now();
    if (range === "12h") return now - 12 * 60 * 60 * 1000;
    if (range === "24h") return now - 24 * 60 * 60 * 1000;
    if (range === "3d") return now - 3 * 24 * 60 * 60 * 1000;
    return 0;
  }

  function value(item, key) {
    const raw = item[key];
    if (raw === null || raw === undefined || raw === "") return null;
    const number = Number(raw);
    return Number.isFinite(number) ? number : null;
  }

  function timeLabel(item) {
    const raw = item.measuredAt || item.createdAt || item.updatedAt;
    if (!raw) return "";
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    return date.toLocaleString("ko-KR", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function updateOne(chart, labels, series) {
    if (!chart) return;
    chart.data.labels = labels;
    chart.data.datasets.forEach(function (set, index) {
      set.data = series[index] || [];
    });
    chart.update();
  }

  function prepareAmountRecords(items, range) {
    const cutoff = cutoffFor(range);
    return (items || []).filter(function (item) {
      const raw = item.recordedAt || item.createdAt || item.updatedAt;
      const stamp = raw ? new Date(raw).getTime() : 0;
      return !cutoff || stamp >= cutoff;
    }).sort(function (a, b) {
      return new Date(a.recordedAt || a.createdAt || 0) - new Date(b.recordedAt || b.createdAt || 0);
    });
  }

  function amountTimeLabel(item) {
    const raw = item.recordedAt || item.createdAt || item.updatedAt;
    if (!raw) return "";
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    return date.toLocaleString("ko-KR", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function update(vitals, range, waterIntake, urineOutput) {
    const cutoff = cutoffFor(range);
    const sorted = (vitals || []).filter(function (item) {
      const raw = item.measuredAt || item.createdAt || item.updatedAt;
      const stamp = raw ? new Date(raw).getTime() : 0;
      return !cutoff || stamp >= cutoff;
    }).sort(function (a, b) {
      return new Date(a.measuredAt || a.createdAt || 0) - new Date(b.measuredAt || b.createdAt || 0);
    });

    const labels = sorted.map(timeLabel);
    updateOne(charts.temperature, labels, [sorted.map(function (item) { return value(item, "temperature"); })]);
    updateOne(charts.spo2, labels, [sorted.map(function (item) { return value(item, "oxygenSaturation"); })]);
    updateOne(charts.bp, labels, [
      sorted.map(function (item) { return value(item, "systolicBp"); }),
      sorted.map(function (item) { return value(item, "diastolicBp"); })
    ]);
    updateOne(charts.pulse, labels, [sorted.map(function (item) { return value(item, "heartRate"); })]);
    updateOne(charts.resp, labels, [sorted.map(function (item) { return value(item, "respiratoryRate"); })]);
    updateOne(charts.pain, labels, [sorted.map(function (item) { return value(item, "painScore"); })]);

    const waterRecords = prepareAmountRecords(waterIntake, range);
    const urineRecords = prepareAmountRecords(urineOutput, range);
    updateOne(
      charts.waterIntake,
      waterRecords.map(amountTimeLabel),
      [waterRecords.map(function (item) { return value(item, "amountMl"); })]
    );
    updateOne(
      charts.urineOutput,
      urineRecords.map(amountTimeLabel),
      [urineRecords.map(function (item) { return value(item, "amountMl"); })]
    );
  }

  window.CareCharts = {
    init: init,
    update: update
  };
})();
