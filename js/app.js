(function () {
  "use strict";

  const FRONTEND_VERSION = "fluid-details-restored-v6";
  const AUTHOR_KEY = "careLog.author";
  const categories = ["증상", "수치 측정", "약물·주사", "검사", "치료", "의사 설명", "간호사 설명", "식사", "수면", "소변·대변", "이동", "보호자 메모", "기타"];
  const treatmentStatuses = {
    planned: "예정",
    completed: "완료",
    cancelled: "취소"
  };

  const state = {
    status: {},
    handoff: {},
    vitals: [],
    waterIntake: [],
    urineOutput: [],
    events: [],
    treatments: [],
    loading: false
  };

  const $ = function (selector) {
    return document.querySelector(selector);
  };

  function author() {
    return localStorage.getItem(AUTHOR_KEY) || "";
  }

  function setAuthor(value) {
    localStorage.setItem(AUTHOR_KEY, value);
  }

  function formatDate(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function toLocalInput(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  }

  function fromLocalInput(value) {
    return value ? new Date(value).toISOString() : null;
  }

  function showToast(message, isError) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.toggle("error", Boolean(isError));
    toast.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(function () {
      toast.hidden = true;
    }, 3200);
  }

  function setNetworkStatus(ok, text) {
    const node = $("#networkStatus");
    node.textContent = text;
    node.classList.toggle("online", ok === true);
    node.classList.toggle("offline", ok === false);
  }

  function option(value, text) {
    const item = document.createElement("option");
    item.value = value;
    item.textContent = text;
    return item;
  }

  function fillSelects() {
    const categorySelect = $("#eventForm select[name='category']");
    categories.forEach(function (category) {
      categorySelect.appendChild(option(category, category));
    });

    const statusSelect = $("#treatmentForm select[name='status']");
    Object.keys(treatmentStatuses).forEach(function (key) {
      statusSelect.appendChild(option(key, treatmentStatuses[key]));
    });
  }

  function showSetup() {
    $("#setupFamilyKey").value = window.CareApi.getFamilyKey();
    $("#setupAuthor").value = author();
    $("#setupOverlay").hidden = false;
  }

  function requireSetup() {
    if (!window.CareApi.getFamilyKey() || !author()) {
      showSetup();
      return true;
    }
    return false;
  }

  function collectForm(form) {
    const data = {};
    Array.from(new FormData(form).entries()).forEach(function (entry) {
      data[entry[0]] = entry[1];
    });
    Array.from(form.querySelectorAll("input[type='checkbox']")).forEach(function (input) {
      data[input.name] = input.checked;
    });
    return data;
  }

  function cleanNumbers(data, fields) {
    fields.forEach(function (field) {
      if (data[field] === "") {
        data[field] = null;
      } else if (data[field] !== undefined) {
        data[field] = Number(data[field]);
      }
    });
    return data;
  }

  function setButtonBusy(button, busy, text) {
    if (!button) return;
    if (busy) {
      button.dataset.originalText = button.textContent;
      button.textContent = text || "저장 중";
      button.disabled = true;
    } else {
      button.textContent = button.dataset.originalText || button.textContent;
      button.disabled = false;
      delete button.dataset.originalText;
    }
  }

  async function runWithButton(button, action, busyText) {
    setButtonBusy(button, true, busyText);
    try {
      await action();
    } catch (err) {
      handleError(err);
    } finally {
      setButtonBusy(button, false);
    }
  }

  function handleError(err) {
    if (err && err.status === 401) {
      showSetup();
      showToast("가족 접근 키를 다시 입력해주세요.", true);
      setNetworkStatus(false, "인증 필요");
      return;
    }
    showToast((err && err.message) || "오류가 발생했습니다.", true);
    setNetworkStatus(false, "연결 오류");
  }

  function setFormValues(form, data) {
    Array.from(form.elements).forEach(function (field) {
      if (!field.name) return;
      if (field.type === "checkbox") {
        field.checked = Boolean(data[field.name]);
      } else if (field.type === "datetime-local") {
        field.value = toLocalInput(data[field.name]);
      } else {
        field.value = data[field.name] === null || data[field.name] === undefined ? "" : data[field.name];
      }
    });
  }

  function resetForm(form) {
    form.reset();
    const idField = form.querySelector("input[name='id']");
    if (idField) idField.value = "";
  }

  function addSummary(parent, label, value) {
    const item = document.createElement("div");
    item.className = "summary-item";
    const labelNode = document.createElement("span");
    labelNode.textContent = label;
    const valueNode = document.createElement("strong");
    valueNode.textContent = value || "-";
    item.append(labelNode, valueNode);
    parent.appendChild(item);
  }

  function textOrDash(value) {
    return value === null || value === undefined || value === "" ? "-" : String(value);
  }

  function parseBloodPressure(value) {
    const match = String(value || "").match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/);
    return match ? { systolicBp: Number(match[1]), diastolicBp: Number(match[2]) } : { systolicBp: null, diastolicBp: null };
  }

  function normalizeVitals(item) {
    const source = item || {};
    const parsed = parseBloodPressure(source.bloodPressure);
    return Object.assign({}, source, {
      systolicBp: source.systolicBp ?? parsed.systolicBp,
      diastolicBp: source.diastolicBp ?? parsed.diastolicBp,
      note: source.note ?? source.memo ?? ""
    });
  }

  function normalizeEvent(item) {
    const source = item || {};
    return Object.assign({}, source, { detail: source.detail ?? source.content ?? "" });
  }

  function normalizeTreatment(item) {
    const source = item || {};
    return Object.assign({}, source, { detail: source.detail ?? source.content ?? "" });
  }

  function makeDetailRow(label, value) {
    const row = document.createElement("div");
    row.className = "detail-row";
    const labelNode = document.createElement("span");
    labelNode.textContent = label;
    const valueNode = document.createElement("strong");
    valueNode.textContent = textOrDash(value);
    row.append(labelNode, valueNode);
    return row;
  }

  function makeToggleButton(titleNode, summaryNode, detailsNode) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "record-toggle";
    button.setAttribute("aria-expanded", "false");
    const hint = document.createElement("span");
    hint.className = "detail-hint";
    hint.textContent = "세부 정보 보기";
    button.append(titleNode);
    if (summaryNode) button.append(summaryNode);
    button.append(hint);
    button.addEventListener("click", function () {
      const opening = detailsNode.hidden;
      detailsNode.hidden = !opening;
      button.setAttribute("aria-expanded", opening ? "true" : "false");
      hint.textContent = opening ? "세부 정보 닫기" : "세부 정보 보기";
    });
    return button;
  }

  function renderStatus() {
    setFormValues($("#statusForm"), state.status || {});
    const editor = state.status.updatedBy || state.status.author || "-";
    $("#statusMeta").textContent = "수정자: " + editor + " · 수정 시각: " + formatDate(state.status.updatedAt);
  }

  function normalizeVitalsItem(item) {
    const normalized = Object.assign({}, item);
    if ((!normalized.systolicBp || !normalized.diastolicBp) && normalized.bloodPressure) {
      const parts = String(normalized.bloodPressure).split("/");
      if (parts.length === 2) {
        normalized.systolicBp = parts[0].trim();
        normalized.diastolicBp = parts[1].trim();
      }
    }
    if (!normalized.note && normalized.memo) {
      normalized.note = normalized.memo;
    }
    return normalized;
  }

  function isToday(value) {
    if (!value) return false;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return false;
    const now = new Date();
    return date.getFullYear() === now.getFullYear()
      && date.getMonth() === now.getMonth()
      && date.getDate() === now.getDate();
  }

  function todayAmount(items) {
    return (items || []).reduce(function (sum, item) {
      if (!isToday(item.recordedAt)) return sum;
      const amount = Number(item.amountMl);
      return sum + (Number.isFinite(amount) ? amount : 0);
    }, 0);
  }

  function latestAmountRecord(items) {
    return (items || []).slice().sort(function (a, b) {
      return new Date(b.recordedAt || b.createdAt || 0) - new Date(a.recordedAt || a.createdAt || 0);
    })[0] || null;
  }

  function latestVitals() {
    return state.vitals.slice().sort(function (a, b) {
      return new Date(b.measuredAt || b.createdAt || 0) - new Date(a.measuredAt || a.createdAt || 0);
    })[0] || null;
  }

  function renderLatestVitals() {
    const parent = $("#latestVitals");
    parent.replaceChildren();
    const raw = latestVitals();
    if (!raw) {
      addSummary(parent, "최근 활력징후", "기록 없음");
      return;
    }
    const latest = normalizeVitals(raw);
    addSummary(parent, "체온", latest.temperature !== null && latest.temperature !== undefined ? latest.temperature + " ℃" : "-");
    addSummary(parent, "심박수", latest.heartRate !== null && latest.heartRate !== undefined ? latest.heartRate + " 회/분" : "-");
    addSummary(parent, "산소포화도", latest.oxygenSaturation !== null && latest.oxygenSaturation !== undefined ? latest.oxygenSaturation + " %" : "-");
    addSummary(parent, "혈압", latest.systolicBp !== null && latest.diastolicBp !== null ? latest.systolicBp + "/" + latest.diastolicBp : "-");
    addSummary(parent, "호흡수", latest.respiratoryRate !== null && latest.respiratoryRate !== undefined ? latest.respiratoryRate + " 회/분" : "-");
    addSummary(parent, "통증 점수", latest.painScore !== null && latest.painScore !== undefined ? String(latest.painScore) : "-");
    addSummary(parent, "측정 시각", formatDate(latest.measuredAt));
    addSummary(parent, "작성자", latest.author || "-");
    addSummary(parent, "측정 메모", latest.note || "-");
  }

  function makeBadge(text, extraClass) {
    const badge = document.createElement("span");
    badge.className = "badge" + (extraClass ? " " + extraClass : "");
    badge.textContent = text;
    return badge;
  }

  function makeButton(text, className, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    if (className) button.className = className;
    button.addEventListener("click", onClick);
    return button;
  }

  function renderVitals() {
    const list = $("#vitalsList");
    list.replaceChildren();
    const sorted = state.vitals.slice().sort(function (a, b) {
      return new Date(b.measuredAt || 0) - new Date(a.measuredAt || 0);
    });
    if (!sorted.length) {
      const empty = document.createElement("p");
      empty.textContent = "활력징후 기록이 없습니다.";
      list.appendChild(empty);
      return;
    }
    sorted.forEach(function (rawItem) {
      const item = normalizeVitals(rawItem);
      const card = document.createElement("article");
      card.className = "record-card";
      const title = document.createElement("div");
      title.className = "record-title";
      const h3 = document.createElement("h3");
      h3.textContent = formatDate(item.measuredAt);
      title.append(h3, makeBadge(item.author || "작성자 없음"));
      const body = document.createElement("p");
      body.textContent = [
        item.temperature !== null && item.temperature !== undefined ? "체온 " + item.temperature + "℃" : "",
        item.heartRate !== null && item.heartRate !== undefined ? "심박수 " + item.heartRate : "",
        item.oxygenSaturation !== null && item.oxygenSaturation !== undefined ? "산소포화도 " + item.oxygenSaturation + "%" : "",
        item.systolicBp !== null && item.diastolicBp !== null ? "혈압 " + item.systolicBp + "/" + item.diastolicBp : "",
        item.respiratoryRate !== null && item.respiratoryRate !== undefined ? "호흡수 " + item.respiratoryRate : "",
        item.painScore !== null && item.painScore !== undefined ? "통증 " + item.painScore : ""
      ].filter(Boolean).join(" · ") || "수치 없음";
      const details = document.createElement("div");
      details.className = "record-details detail-grid";
      details.hidden = true;
      details.append(
        makeDetailRow("체온", item.temperature !== null && item.temperature !== undefined ? item.temperature + " ℃" : "-"),
        makeDetailRow("심박수", item.heartRate !== null && item.heartRate !== undefined ? item.heartRate + " 회/분" : "-"),
        makeDetailRow("산소포화도", item.oxygenSaturation !== null && item.oxygenSaturation !== undefined ? item.oxygenSaturation + " %" : "-"),
        makeDetailRow("수축기 혈압", item.systolicBp),
        makeDetailRow("이완기 혈압", item.diastolicBp),
        makeDetailRow("호흡수", item.respiratoryRate !== null && item.respiratoryRate !== undefined ? item.respiratoryRate + " 회/분" : "-"),
        makeDetailRow("통증 점수", item.painScore),
        makeDetailRow("측정 메모", item.note),
        makeDetailRow("작성자", item.author),
        makeDetailRow("측정 시각", formatDate(item.measuredAt))
      );
      const actions = document.createElement("div");
      actions.className = "record-actions";
      actions.append(
        makeButton("수정", "", function () { editVitals(item); }),
        makeButton("삭제", "danger", function () { removeVitals(item.id); })
      );
      card.append(makeToggleButton(title, body, details), details, actions);
      list.appendChild(card);
    });
  }

  function renderAmountSummary(parentSelector, items, latestLabel, todayLabel) {
    const parent = $(parentSelector);
    parent.replaceChildren();
    const latest = latestAmountRecord(items);
    addSummary(parent, latestLabel, latest ? latest.amountMl + " mL" : "기록 없음");
    addSummary(parent, todayLabel, todayAmount(items) + " mL");
  }

  function renderAmountRecords(listSelector, items, emptyMessage, editHandler, removeHandler) {
    const list = $(listSelector);
    list.replaceChildren();
    const sorted = (items || []).slice().sort(function (a, b) {
      return new Date(b.recordedAt || b.createdAt || 0) - new Date(a.recordedAt || a.createdAt || 0);
    });
    if (!sorted.length) {
      const empty = document.createElement("p");
      empty.textContent = emptyMessage;
      list.appendChild(empty);
      return;
    }
    sorted.forEach(function (item) {
      const card = document.createElement("article");
      card.className = "record-card";
      const title = document.createElement("div");
      title.className = "record-title";
      const h3 = document.createElement("h3");
      h3.textContent = formatDate(item.recordedAt);
      title.append(h3, makeBadge(item.author || "작성자 없음"));
      const summary = document.createElement("p");
      summary.textContent = item.amountMl + " mL";
      const details = document.createElement("div");
      details.className = "record-details detail-grid";
      details.hidden = true;
      details.append(
        makeDetailRow("기록량", item.amountMl + " mL"),
        makeDetailRow("메모", item.note),
        makeDetailRow("작성자", item.author),
        makeDetailRow("기록 시각", formatDate(item.recordedAt))
      );
      const actions = document.createElement("div");
      actions.className = "record-actions";
      actions.append(
        makeButton("수정", "", function () { editHandler(item); }),
        makeButton("삭제", "danger", function () { removeHandler(item.id); })
      );
      card.append(makeToggleButton(title, summary, details), details, actions);
      list.appendChild(card);
    });
  }

  function renderWaterIntake() {
    renderAmountSummary(
      "#waterIntakeSummary",
      state.waterIntake,
      "최근 물 섭취량",
      "오늘 물 섭취 누계"
    );
    renderAmountRecords(
      "#waterIntakeList",
      state.waterIntake,
      "물 섭취 기록이 없습니다.",
      editWaterIntake,
      removeWaterIntake
    );
  }

  function renderUrineOutput() {
    renderAmountSummary(
      "#urineOutputSummary",
      state.urineOutput,
      "최근 소변량",
      "오늘 소변량 누계"
    );
    renderAmountRecords(
      "#urineOutputList",
      state.urineOutput,
      "소변량 기록이 없습니다.",
      editUrineOutput,
      removeUrineOutput
    );
  }

  function renderEvents() {
    const list = $("#eventList");
    list.replaceChildren();
    const sorted = state.events.slice().sort(function (a, b) {
      return new Date(b.occurredAt || 0) - new Date(a.occurredAt || 0);
    });
    if (!sorted.length) {
      const empty = document.createElement("p");
      empty.textContent = "이벤트 기록이 없습니다.";
      list.appendChild(empty);
      return;
    }
    sorted.forEach(function (rawItem) {
      const item = normalizeEvent(rawItem);
      const card = document.createElement("article");
      card.className = "record-card";
      const title = document.createElement("div");
      title.className = "record-title";
      const h3 = document.createElement("h3");
      h3.textContent = item.title || "제목 없음";
      title.append(h3, makeBadge(item.category || "기타", item.isImportant ? "important" : ""));
      const meta = document.createElement("p");
      meta.textContent = formatDate(item.occurredAt) + " · " + (item.author || "작성자 없음") + (item.isImportant ? " · 중요 기록" : "");
      const details = document.createElement("div");
      details.className = "record-details detail-grid";
      details.hidden = true;
      details.append(
        makeDetailRow("분류", item.category),
        makeDetailRow("제목", item.title),
        makeDetailRow("상세 내용", item.detail),
        makeDetailRow("중요 기록", item.isImportant ? "예" : "아니요"),
        makeDetailRow("작성자", item.author),
        makeDetailRow("발생 시각", formatDate(item.occurredAt))
      );
      const actions = document.createElement("div");
      actions.className = "record-actions";
      actions.append(
        makeButton("수정", "", function () { editEvent(item); }),
        makeButton("삭제", "danger", function () { removeEvent(item.id); })
      );
      card.append(makeToggleButton(title, meta, details), details, actions);
      list.appendChild(card);
    });
  }

  function renderTreatments() {
    const list = $("#treatmentList");
    list.replaceChildren();
    const order = { planned: 0, completed: 1, cancelled: 2 };
    const sorted = state.treatments.slice().sort(function (a, b) {
      const statusDiff = (order[a.status] ?? 9) - (order[b.status] ?? 9);
      return statusDiff || new Date(a.scheduledAt || 0) - new Date(b.scheduledAt || 0);
    });
    if (!sorted.length) {
      const empty = document.createElement("p");
      empty.textContent = "치료 및 할 일 기록이 없습니다.";
      list.appendChild(empty);
      return;
    }
    sorted.forEach(function (rawItem) {
      const item = normalizeTreatment(rawItem);
      const card = document.createElement("article");
      card.className = "record-card";
      const title = document.createElement("div");
      title.className = "record-title";
      const h3 = document.createElement("h3");
      h3.textContent = item.title || "제목 없음";
      title.append(h3, makeBadge(treatmentStatuses[item.status] || item.status || "예정", item.status || ""));
      const meta = document.createElement("p");
      meta.textContent = formatDate(item.scheduledAt) + " · " + (item.author || "작성자 없음");
      const details = document.createElement("div");
      details.className = "record-details detail-grid";
      details.hidden = true;
      details.append(
        makeDetailRow("제목", item.title),
        makeDetailRow("상세 내용", item.detail),
        makeDetailRow("진행 상태", treatmentStatuses[item.status] || item.status),
        makeDetailRow("예정 시각", formatDate(item.scheduledAt)),
        makeDetailRow("완료 시각", formatDate(item.completedAt)),
        makeDetailRow("완료 처리자", item.completedBy),
        makeDetailRow("작성자", item.author)
      );
      const actions = document.createElement("div");
      actions.className = "record-actions";
      actions.append(makeButton("수정", "", function () { editTreatment(item); }));
      if (item.status !== "completed") actions.append(makeButton("완료", "", function () { changeTreatmentStatus(item, "completed"); }));
      if (item.status !== "cancelled") actions.append(makeButton("취소", "", function () { changeTreatmentStatus(item, "cancelled"); }));
      actions.append(makeButton("삭제", "danger", function () { removeTreatment(item.id); }));
      card.append(makeToggleButton(title, meta, details), details, actions);
      list.appendChild(card);
    });
  }

  function handoffText() {
    const latest = latestVitals();
    const important = state.events.filter(function (item) { return item.isImportant; }).slice(0, 5);
    const openTreatments = state.treatments.filter(function (item) { return item.status !== "completed" && item.status !== "cancelled"; });
    const lines = [];
    lines.push("[직접 입력 메모]");
    lines.push((state.handoff && state.handoff.note) || "없음");
    lines.push("");
    lines.push("[최근 활력징후]");
    lines.push(latest ? formatDate(latest.measuredAt) + " · 체온 " + (latest.temperature || "-") + " · 산소포화도 " + (latest.oxygenSaturation || "-") + " · 혈압 " + (latest.systolicBp || "-") + "/" + (latest.diastolicBp || "-") + " · 통증 " + (latest.painScore ?? "-") : "없음");
    lines.push("");
    lines.push("[오늘 물 섭취량]");
    lines.push(todayAmount(state.waterIntake) + " mL");
    lines.push("");
    lines.push("[오늘 소변량]");
    lines.push(todayAmount(state.urineOutput) + " mL");
    lines.push("");
    lines.push("[최근 중요 이벤트]");
    if (important.length) {
      important.forEach(function (item) {
        lines.push("- " + formatDate(item.occurredAt) + " · " + (item.category || "기타") + " · " + (item.title || "제목 없음"));
      });
    } else {
      lines.push("없음");
    }
    lines.push("");
    lines.push("[완료되지 않은 일정]");
    if (openTreatments.length) {
      openTreatments.forEach(function (item) {
        lines.push("- " + formatDate(item.scheduledAt) + " · " + (item.title || "제목 없음") + " · " + (treatmentStatuses[item.status] || item.status || "예정"));
      });
    } else {
      lines.push("없음");
    }
    return lines.join("\n");
  }

  function renderHandoff() {
    setFormValues($("#handoffForm"), state.handoff || {});
    $("#handoffPreview").textContent = handoffText();
  }

  function renderAll() {
    renderStatus();
    renderLatestVitals();
    renderVitals();
    renderWaterIntake();
    renderUrineOutput();
    renderEvents();
    renderTreatments();
    renderHandoff();
    window.CareCharts.update(
      state.vitals,
      $("#chartRange").value,
      state.waterIntake,
      state.urineOutput
    );
  }

  async function loadAll(silent) {
    if (state.loading || requireSetup()) return;
    state.loading = true;
    try {
      const results = await Promise.all([
        window.CareApi.health(),
        window.CareApi.getStatus(),
        window.CareApi.getHandoff(),
        window.CareApi.listVitals(),
        window.CareApi.listWaterIntake(),
        window.CareApi.listUrineOutput(),
        window.CareApi.listEvents(),
        window.CareApi.listTreatments()
      ]);
      state.status = results[1] || {};
      state.handoff = results[2] || {};
      state.vitals = ((results[3] && results[3].items) || []).map(normalizeVitals);
      state.waterIntake = (results[4] && results[4].items) || [];
      state.urineOutput = (results[5] && results[5].items) || [];
      state.events = ((results[6] && results[6].items) || []).map(normalizeEvent);
      state.treatments = ((results[7] && results[7].items) || []).map(normalizeTreatment);
      renderAll();
      setNetworkStatus(true, "연결됨");
      $("#lastUpdated").textContent = "마지막 동기화: " + formatDate(new Date().toISOString());
      if (!silent) showToast("데이터를 새로고침했습니다.");
    } catch (err) {
      handleError(err);
    } finally {
      state.loading = false;
    }
  }

  function vitalsPayload(form) {
    const data = cleanNumbers(collectForm(form), ["temperature", "heartRate", "oxygenSaturation", "systolicBp", "diastolicBp", "respiratoryRate", "painScore"]);
    data.measuredAt = fromLocalInput(data.measuredAt) || new Date().toISOString();
    data.author = author();
    data.bloodPressure = data.systolicBp !== null && data.diastolicBp !== null
      ? data.systolicBp + "/" + data.diastolicBp
      : null;
    data.memo = data.note || "";
    delete data.id;
    delete data.systolicBp;
    delete data.diastolicBp;
    delete data.note;
    return data;
  }

  function amountPayload(form) {
    const data = cleanNumbers(collectForm(form), ["amountMl"]);
    data.recordedAt = fromLocalInput(data.recordedAt) || new Date().toISOString();
    data.author = author();
    delete data.id;
    return data;
  }

  function hasVitalsNumber(data) {
    return ["temperature", "heartRate", "oxygenSaturation", "bloodPressure", "respiratoryRate", "painScore"].some(function (field) {
      return data[field] !== null && data[field] !== undefined && data[field] !== "";
    });
  }

  function editVitals(item) {
    setFormValues($("#vitalsForm"), normalizeVitals(item));
    $("#saveVitalsButton").textContent = "수정 저장";
    $("#cancelVitalsEdit").hidden = false;
    window.scrollTo({ top: $("#vitalsForm").offsetTop - 90, behavior: "smooth" });
  }

  function editWaterIntake(item) {
    setFormValues($("#waterIntakeForm"), item);
    $("#saveWaterIntakeButton").textContent = "수정 저장";
    $("#cancelWaterIntakeEdit").hidden = false;
    window.scrollTo({ top: $("#waterIntakeForm").offsetTop - 90, behavior: "smooth" });
  }

  function editUrineOutput(item) {
    setFormValues($("#urineOutputForm"), item);
    $("#saveUrineOutputButton").textContent = "수정 저장";
    $("#cancelUrineOutputEdit").hidden = false;
    window.scrollTo({ top: $("#urineOutputForm").offsetTop - 90, behavior: "smooth" });
  }

  function editEvent(item) {
    setFormValues($("#eventForm"), normalizeEvent(item));
    $("#saveEventButton").textContent = "수정 저장";
    $("#cancelEventEdit").hidden = false;
  }

  function editTreatment(item) {
    setFormValues($("#treatmentForm"), normalizeTreatment(item));
    $("#saveTreatmentButton").textContent = "수정 저장";
    $("#cancelTreatmentEdit").hidden = false;
  }

  function resetVitalsEdit() {
    resetForm($("#vitalsForm"));
    $("#vitalsForm input[name='measuredAt']").value = toLocalInput(new Date().toISOString());
    $("#saveVitalsButton").textContent = "추가";
    $("#cancelVitalsEdit").hidden = true;
  }

  function resetWaterIntakeEdit() {
    resetForm($("#waterIntakeForm"));
    $("#waterIntakeForm input[name='recordedAt']").value = toLocalInput(new Date().toISOString());
    $("#saveWaterIntakeButton").textContent = "추가";
    $("#cancelWaterIntakeEdit").hidden = true;
  }

  function resetUrineOutputEdit() {
    resetForm($("#urineOutputForm"));
    $("#urineOutputForm input[name='recordedAt']").value = toLocalInput(new Date().toISOString());
    $("#saveUrineOutputButton").textContent = "추가";
    $("#cancelUrineOutputEdit").hidden = true;
  }

  function resetEventEdit() {
    resetForm($("#eventForm"));
    $("#saveEventButton").textContent = "추가";
    $("#cancelEventEdit").hidden = true;
  }

  function resetTreatmentEdit() {
    resetForm($("#treatmentForm"));
    $("#treatmentForm select[name='status']").value = "planned";
    $("#saveTreatmentButton").textContent = "추가";
    $("#cancelTreatmentEdit").hidden = true;
  }

  async function removeVitals(id) {
    if (!confirm("이 활력징후 기록을 삭제할까요?")) return;
    await runWithButton(null, async function () {
      await window.CareApi.deleteVitals(id);
      showToast("활력징후 기록을 삭제했습니다.");
      await loadAll(true);
    });
  }

  async function removeWaterIntake(id) {
    if (!confirm("이 물 섭취 기록을 삭제할까요?")) return;
    await runWithButton(null, async function () {
      await window.CareApi.deleteWaterIntake(id);
      showToast("물 섭취 기록을 삭제했습니다.");
      await loadAll(true);
    });
  }

  async function removeUrineOutput(id) {
    if (!confirm("이 소변량 기록을 삭제할까요?")) return;
    await runWithButton(null, async function () {
      await window.CareApi.deleteUrineOutput(id);
      showToast("소변량 기록을 삭제했습니다.");
      await loadAll(true);
    });
  }

  async function removeEvent(id) {
    if (!confirm("이 이벤트 기록을 삭제할까요?")) return;
    await runWithButton(null, async function () {
      await window.CareApi.deleteEvent(id);
      showToast("이벤트 기록을 삭제했습니다.");
      await loadAll(true);
    });
  }

  async function removeTreatment(id) {
    if (!confirm("이 치료 및 할 일을 삭제할까요?")) return;
    await runWithButton(null, async function () {
      await window.CareApi.deleteTreatment(id);
      showToast("치료 및 할 일을 삭제했습니다.");
      await loadAll(true);
    });
  }

  async function changeTreatmentStatus(item, status) {
    await runWithButton(null, async function () {
      const payload = Object.assign({}, item, { status: status, author: author() });
      await window.CareApi.updateTreatment(item.id, payload);
      showToast("상태를 변경했습니다.");
      await loadAll(true);
    });
  }

  function bindForms() {
    $("#setupForm").addEventListener("submit", function (event) {
      event.preventDefault();
      window.CareApi.setFamilyKey($("#setupFamilyKey").value.trim());
      setAuthor($("#setupAuthor").value.trim());
      $("#setupOverlay").hidden = true;
      loadAll(false);
    });

    $("#statusForm").addEventListener("submit", function (event) {
      event.preventDefault();
      const button = $("#saveStatusButton");
      runWithButton(button, async function () {
        const data = cleanNumbers(collectForm(event.currentTarget), ["painScore"]);
        data.updatedBy = author();
        await window.CareApi.saveStatus(data);
        showToast("현재 상태를 저장했습니다.");
        await loadAll(true);
      });
    });

    $("#handoffForm").addEventListener("submit", function (event) {
      event.preventDefault();
      runWithButton($("#saveHandoffButton"), async function () {
        const data = collectForm(event.currentTarget);
        data.author = author();
        await window.CareApi.saveHandoff(data);
        showToast("인계 메모를 저장했습니다.");
        await loadAll(true);
      });
    });

    $("#vitalsForm").addEventListener("submit", function (event) {
      event.preventDefault();
      const form = event.currentTarget;
      const id = form.elements.id.value;
      const data = vitalsPayload(form);
      if (!hasVitalsNumber(data)) {
        showToast("활력징후 수치를 최소 한 개 이상 입력해주세요.", true);
        return;
      }
      runWithButton($("#saveVitalsButton"), async function () {
        if (id) {
          await window.CareApi.updateVitals(id, data);
          showToast("활력징후 기록을 수정했습니다.");
        } else {
          await window.CareApi.createVitals(data);
          showToast("활력징후 기록을 추가했습니다.");
        }
        resetVitalsEdit();
        await loadAll(true);
      });
    });

    $("#waterIntakeForm").addEventListener("submit", function (event) {
      event.preventDefault();
      const form = event.currentTarget;
      const id = form.elements.id.value;
      const data = amountPayload(form);
      runWithButton($("#saveWaterIntakeButton"), async function () {
        if (id) {
          await window.CareApi.updateWaterIntake(id, data);
          showToast("물 섭취 기록을 수정했습니다.");
        } else {
          await window.CareApi.createWaterIntake(data);
          showToast("물 섭취 기록을 추가했습니다.");
        }
        resetWaterIntakeEdit();
        await loadAll(true);
      });
    });

    $("#urineOutputForm").addEventListener("submit", function (event) {
      event.preventDefault();
      const form = event.currentTarget;
      const id = form.elements.id.value;
      const data = amountPayload(form);
      runWithButton($("#saveUrineOutputButton"), async function () {
        if (id) {
          await window.CareApi.updateUrineOutput(id, data);
          showToast("소변량 기록을 수정했습니다.");
        } else {
          await window.CareApi.createUrineOutput(data);
          showToast("소변량 기록을 추가했습니다.");
        }
        resetUrineOutputEdit();
        await loadAll(true);
      });
    });

    $("#eventForm").addEventListener("submit", function (event) {
      event.preventDefault();
      const form = event.currentTarget;
      const id = form.elements.id.value;
      const data = collectForm(form);
      data.occurredAt = fromLocalInput(data.occurredAt);
      data.author = author();
      delete data.id;
      runWithButton($("#saveEventButton"), async function () {
        if (id) {
          await window.CareApi.updateEvent(id, data);
          showToast("이벤트 기록을 수정했습니다.");
        } else {
          await window.CareApi.createEvent(data);
          showToast("이벤트 기록을 추가했습니다.");
        }
        resetEventEdit();
        await loadAll(true);
      });
    });

    $("#treatmentForm").addEventListener("submit", function (event) {
      event.preventDefault();
      const form = event.currentTarget;
      const id = form.elements.id.value;
      const data = collectForm(form);
      data.scheduledAt = fromLocalInput(data.scheduledAt);
      data.author = author();
      delete data.id;
      runWithButton($("#saveTreatmentButton"), async function () {
        if (id) {
          await window.CareApi.updateTreatment(id, data);
          showToast("치료 및 할 일을 수정했습니다.");
        } else {
          await window.CareApi.createTreatment(data);
          showToast("치료 및 할 일을 추가했습니다.");
        }
        resetTreatmentEdit();
        await loadAll(true);
      });
    });
  }

  function bindActions() {
    $("#refreshButton").addEventListener("click", function () { loadAll(false); });
    $("#settingsButton").addEventListener("click", showSetup);
    $("#chartRange").addEventListener("change", function () {
      window.CareCharts.update(
        state.vitals,
        $("#chartRange").value,
        state.waterIntake,
        state.urineOutput
      );
    });
    $("#cancelVitalsEdit").addEventListener("click", resetVitalsEdit);
    $("#cancelWaterIntakeEdit").addEventListener("click", resetWaterIntakeEdit);
    $("#cancelUrineOutputEdit").addEventListener("click", resetUrineOutputEdit);
    $("#cancelEventEdit").addEventListener("click", resetEventEdit);
    $("#cancelTreatmentEdit").addEventListener("click", resetTreatmentEdit);

    $("#copyHandoffButton").addEventListener("click", async function () {
      try {
        await navigator.clipboard.writeText(handoffText());
        showToast("인계 내용을 복사했습니다.");
      } catch (err) {
        showToast("복사하지 못했습니다. 브라우저 권한을 확인해주세요.", true);
      }
    });

    $("#exportJsonButton").addEventListener("click", function () {
      runWithButton($("#exportJsonButton"), async function () {
        await window.CareApi.downloadExport();
        showToast("전체 JSON을 내려받았습니다.");
      }, "내려받는 중");
    });

    $("#backupSqliteButton").addEventListener("click", function () {
      runWithButton($("#backupSqliteButton"), async function () {
        await window.CareApi.downloadBackup();
        showToast("SQLite 백업 파일을 내려받았습니다.");
      }, "내려받는 중");
    });

  }

  function setDefaultTimes() {
    const now = toLocalInput(new Date().toISOString());
    $("#vitalsForm input[name='measuredAt']").value = now;
    $("#waterIntakeForm input[name='recordedAt']").value = now;
    $("#urineOutputForm input[name='recordedAt']").value = now;
    $("#eventForm input[name='occurredAt']").value = now;
    $("#treatmentForm input[name='scheduledAt']").value = now;
    $("#treatmentForm select[name='status']").value = "planned";
  }

  function init() {
    console.log("가족 간병 기록 프론트엔드 버전:", FRONTEND_VERSION);
    fillSelects();
    window.CareCharts.init();
    bindForms();
    bindActions();
    setDefaultTimes();
    if (!requireSetup()) {
      loadAll(true);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
