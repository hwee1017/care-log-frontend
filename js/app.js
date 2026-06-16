(function () {
  "use strict";

  const AUTHOR_KEY = "careLog.author";
  const STATUS_META_PREFIX = "__CARE_LOG_STATUS_V1__:";
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

  function hasValue(value) {
    return value !== null && value !== undefined && value !== "";
  }

  function textOrDash(value) {
    return hasValue(value) ? String(value) : "-";
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

  function parseStoredStatusMeta(painValue) {
    if (typeof painValue !== "string" || !painValue.startsWith(STATUS_META_PREFIX)) {
      return {
        consciousness: "",
        painLocation: painValue || "",
        painScore: null,
        updatedBy: ""
      };
    }
    try {
      const parsed = JSON.parse(painValue.slice(STATUS_META_PREFIX.length));
      return {
        consciousness: parsed.consciousness || "",
        painLocation: parsed.painLocation || "",
        painScore: parsed.painScore === null || parsed.painScore === undefined ? null : Number(parsed.painScore),
        updatedBy: parsed.updatedBy || ""
      };
    } catch (err) {
      return {
        consciousness: "",
        painLocation: painValue,
        painScore: null,
        updatedBy: ""
      };
    }
  }

  function normalizeStatus(raw) {
    const item = raw || {};
    const storedMeta = parseStoredStatusMeta(item.pain);
    return {
      overallStatus: item.overallStatus !== undefined ? item.overallStatus : (item.currentState || ""),
      consciousness: item.consciousness !== undefined ? item.consciousness : storedMeta.consciousness,
      painLocation: item.painLocation !== undefined ? item.painLocation : storedMeta.painLocation,
      painScore: item.painScore !== undefined ? item.painScore : storedMeta.painScore,
      mealStatus: item.mealStatus !== undefined ? item.mealStatus : (item.meal || ""),
      sleepStatus: item.sleepStatus !== undefined ? item.sleepStatus : (item.sleep || ""),
      urineStool: item.urineStool !== undefined ? item.urineStool : (item.bowelMovement || ""),
      mobility: item.mobility !== undefined ? item.mobility : (item.walking || ""),
      cautions: item.cautions || item.caution || "",
      memo: item.memo || "",
      updatedBy: item.updatedBy || item.author || storedMeta.updatedBy || "",
      updatedAt: item.updatedAt || null
    };
  }

  function statusPayload(form) {
    const data = cleanNumbers(collectForm(form), ["painScore"]);
    const painMeta = {
      consciousness: data.consciousness || "",
      painLocation: data.painLocation || "",
      painScore: data.painScore,
      updatedBy: author()
    };
    return {
      currentState: data.overallStatus || "",
      pain: STATUS_META_PREFIX + JSON.stringify(painMeta),
      meal: data.mealStatus || "",
      sleep: data.sleepStatus || "",
      bowelMovement: data.urineStool || "",
      walking: data.mobility || "",
      cautions: data.cautions || "",
      memo: data.memo || ""
    };
  }

  function normalizeHandoff(raw) {
    const item = raw || {};
    return {
      note: item.note !== undefined ? item.note : (item.content || ""),
      updatedAt: item.updatedAt || null
    };
  }

  function parseBloodPressure(value) {
    if (!value) return { systolicBp: null, diastolicBp: null };
    const match = String(value).match(/(\d+)\s*[\/\-]\s*(\d+)/);
    if (!match) return { systolicBp: null, diastolicBp: null };
    return {
      systolicBp: Number(match[1]),
      diastolicBp: Number(match[2])
    };
  }

  function normalizeVitals(raw) {
    const item = raw || {};
    const parsedBp = parseBloodPressure(item.bloodPressure);
    return Object.assign({}, item, {
      systolicBp: hasValue(item.systolicBp) ? Number(item.systolicBp) : parsedBp.systolicBp,
      diastolicBp: hasValue(item.diastolicBp) ? Number(item.diastolicBp) : parsedBp.diastolicBp,
      note: item.note !== undefined ? item.note : (item.memo || "")
    });
  }

  function normalizeEvent(raw) {
    const item = raw || {};
    return Object.assign({}, item, {
      detail: item.detail !== undefined ? item.detail : (item.content || "")
    });
  }

  function normalizeTreatment(raw) {
    const item = raw || {};
    return Object.assign({}, item, {
      detail: item.detail !== undefined ? item.detail : (item.content || "")
    });
  }

  function addSummary(parent, label, value) {
    const item = document.createElement("div");
    item.className = "summary-item";
    const labelNode = document.createElement("span");
    labelNode.textContent = label;
    const valueNode = document.createElement("strong");
    valueNode.textContent = hasValue(value) ? String(value) : "-";
    item.append(labelNode, valueNode);
    parent.appendChild(item);
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

  function makeRecordDetails(titleText, badgeNode, subtitleText) {
    const details = document.createElement("details");
    details.className = "record-card collapsible-card";

    const summary = document.createElement("summary");
    summary.className = "record-summary";

    const headingWrap = document.createElement("div");
    headingWrap.className = "record-heading";
    const heading = document.createElement("h3");
    heading.textContent = titleText;
    headingWrap.appendChild(heading);
    if (subtitleText) {
      const subtitle = document.createElement("p");
      subtitle.textContent = subtitleText;
      headingWrap.appendChild(subtitle);
    }

    summary.appendChild(headingWrap);
    if (badgeNode) summary.appendChild(badgeNode);
    details.appendChild(summary);
    return details;
  }

  function renderStatus() {
    setFormValues($("#statusForm"), state.status || {});
    const editor = state.status.updatedBy || "-";
    $("#statusMeta").textContent = "수정자: " + editor + " · 수정 시각: " + formatDate(state.status.updatedAt);
    renderStatusPreview();
  }

  function renderStatusPreview() {
    const parent = $("#statusPreview");
    parent.replaceChildren();
    const item = state.status || {};
    const hasStatus = [
      item.overallStatus,
      item.consciousness,
      item.painLocation,
      item.painScore,
      item.mealStatus,
      item.sleepStatus,
      item.urineStool,
      item.mobility,
      item.cautions,
      item.memo
    ].some(hasValue);

    if (!hasStatus) {
      const empty = document.createElement("p");
      empty.className = "empty-message";
      empty.textContent = "저장된 현재 상태가 없습니다.";
      parent.appendChild(empty);
      return;
    }

    const summaryText = item.overallStatus || item.memo || "저장된 현재 상태";
    const card = makeRecordDetails(
      summaryText,
      makeBadge(item.updatedBy || "작성자 없음"),
      "클릭하면 저장된 세부 내용을 볼 수 있습니다. · " + formatDate(item.updatedAt)
    );
    const grid = document.createElement("div");
    grid.className = "record-detail-grid";
    grid.append(
      makeDetailRow("전반 상태", item.overallStatus),
      makeDetailRow("의식 상태", item.consciousness),
      makeDetailRow("통증 부위", item.painLocation),
      makeDetailRow("통증 점수", item.painScore),
      makeDetailRow("식사 상태", item.mealStatus),
      makeDetailRow("수면 상태", item.sleepStatus),
      makeDetailRow("소변 및 대변", item.urineStool),
      makeDetailRow("보행 상태", item.mobility),
      makeDetailRow("주의사항", item.cautions),
      makeDetailRow("자유 메모", item.memo)
    );
    card.appendChild(grid);
    parent.appendChild(card);
  }

  function latestVitals() {
    return state.vitals.slice().sort(function (a, b) {
      return new Date(b.measuredAt || b.createdAt || 0) - new Date(a.measuredAt || a.createdAt || 0);
    })[0] || null;
  }

  function renderLatestVitals() {
    const parent = $("#latestVitals");
    parent.replaceChildren();
    const latest = latestVitals();
    if (!latest) {
      addSummary(parent, "최근 활력징후", "기록 없음");
      return;
    }
    addSummary(parent, "체온", hasValue(latest.temperature) ? latest.temperature + " ℃" : "-");
    addSummary(parent, "심박수", hasValue(latest.heartRate) ? latest.heartRate + " 회/분" : "-");
    addSummary(parent, "산소포화도", hasValue(latest.oxygenSaturation) ? latest.oxygenSaturation + " %" : "-");
    addSummary(parent, "혈압", hasValue(latest.systolicBp) || hasValue(latest.diastolicBp) ? textOrDash(latest.systolicBp) + "/" + textOrDash(latest.diastolicBp) : "-");
    addSummary(parent, "호흡수", hasValue(latest.respiratoryRate) ? latest.respiratoryRate + " 회/분" : "-");
    addSummary(parent, "통증 점수", latest.painScore);
    addSummary(parent, "측정 시각", formatDate(latest.measuredAt));
    addSummary(parent, "작성자", latest.author || "-");
    addSummary(parent, "측정 메모", latest.note || "-");
  }

  function renderVitals() {
    const list = $("#vitalsList");
    list.replaceChildren();
    const sorted = state.vitals.slice().sort(function (a, b) {
      return new Date(b.measuredAt || b.createdAt || 0) - new Date(a.measuredAt || a.createdAt || 0);
    });
    if (!sorted.length) {
      const empty = document.createElement("p");
      empty.textContent = "활력징후 기록이 없습니다.";
      list.appendChild(empty);
      return;
    }

    sorted.forEach(function (item) {
      const compact = [
        hasValue(item.temperature) ? "체온 " + item.temperature + "℃" : "",
        hasValue(item.heartRate) ? "심박수 " + item.heartRate : "",
        hasValue(item.oxygenSaturation) ? "산소포화도 " + item.oxygenSaturation + "%" : "",
        hasValue(item.systolicBp) || hasValue(item.diastolicBp) ? "혈압 " + textOrDash(item.systolicBp) + "/" + textOrDash(item.diastolicBp) : "",
        hasValue(item.respiratoryRate) ? "호흡수 " + item.respiratoryRate : "",
        hasValue(item.painScore) ? "통증 " + item.painScore : ""
      ].filter(Boolean).join(" · ") || "수치 없음";

      const card = makeRecordDetails(
        formatDate(item.measuredAt),
        makeBadge(item.author || "작성자 없음"),
        compact + " · 클릭하여 세부 내용 보기"
      );

      const grid = document.createElement("div");
      grid.className = "record-detail-grid";
      grid.append(
        makeDetailRow("체온", hasValue(item.temperature) ? item.temperature + " ℃" : "-"),
        makeDetailRow("심박수", hasValue(item.heartRate) ? item.heartRate + " 회/분" : "-"),
        makeDetailRow("산소포화도", hasValue(item.oxygenSaturation) ? item.oxygenSaturation + " %" : "-"),
        makeDetailRow("수축기 혈압", item.systolicBp),
        makeDetailRow("이완기 혈압", item.diastolicBp),
        makeDetailRow("호흡수", hasValue(item.respiratoryRate) ? item.respiratoryRate + " 회/분" : "-"),
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
      card.append(grid, actions);
      list.appendChild(card);
    });
  }

  function renderEvents() {
    const list = $("#eventList");
    list.replaceChildren();
    const sorted = state.events.slice().sort(function (a, b) {
      return new Date(b.occurredAt || b.createdAt || 0) - new Date(a.occurredAt || a.createdAt || 0);
    });
    if (!sorted.length) {
      const empty = document.createElement("p");
      empty.textContent = "이벤트 기록이 없습니다.";
      list.appendChild(empty);
      return;
    }

    sorted.forEach(function (item) {
      const card = makeRecordDetails(
        item.title || "제목 없음",
        makeBadge(item.category || "기타", item.isImportant ? "important" : ""),
        formatDate(item.occurredAt) + " · " + (item.author || "작성자 없음") + " · 클릭하여 세부 내용 보기"
      );
      const grid = document.createElement("div");
      grid.className = "record-detail-grid";
      grid.append(
        makeDetailRow("발생 시각", formatDate(item.occurredAt)),
        makeDetailRow("분류", item.category),
        makeDetailRow("제목", item.title),
        makeDetailRow("상세 내용", item.detail),
        makeDetailRow("중요 기록", item.isImportant ? "예" : "아니요"),
        makeDetailRow("작성자", item.author)
      );
      const actions = document.createElement("div");
      actions.className = "record-actions";
      actions.append(
        makeButton("수정", "", function () { editEvent(item); }),
        makeButton("삭제", "danger", function () { removeEvent(item.id); })
      );
      card.append(grid, actions);
      list.appendChild(card);
    });
  }

  function renderTreatments() {
    const list = $("#treatmentList");
    list.replaceChildren();
    const statusOrder = { planned: 0, completed: 1, cancelled: 2 };
    const sorted = state.treatments.slice().sort(function (a, b) {
      const statusDifference = (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99);
      if (statusDifference !== 0) return statusDifference;
      return new Date(a.scheduledAt || 0) - new Date(b.scheduledAt || 0);
    });
    if (!sorted.length) {
      const empty = document.createElement("p");
      empty.textContent = "치료 및 할 일이 없습니다.";
      list.appendChild(empty);
      return;
    }

    sorted.forEach(function (item) {
      const card = makeRecordDetails(
        item.title || "제목 없음",
        makeBadge(treatmentStatuses[item.status] || item.status || "예정", item.status || ""),
        formatDate(item.scheduledAt) + " · " + (item.author || "작성자 없음") + " · 클릭하여 세부 내용 보기"
      );
      const grid = document.createElement("div");
      grid.className = "record-detail-grid";
      grid.append(
        makeDetailRow("예정 시각", formatDate(item.scheduledAt)),
        makeDetailRow("진행 상태", treatmentStatuses[item.status] || item.status),
        makeDetailRow("제목", item.title),
        makeDetailRow("상세 내용", item.detail),
        makeDetailRow("작성자", item.author),
        makeDetailRow("완료 시각", formatDate(item.completedAt)),
        makeDetailRow("완료 처리자", item.completedBy)
      );
      const actions = document.createElement("div");
      actions.className = "record-actions";
      actions.append(makeButton("수정", "", function () { editTreatment(item); }));
      if (item.status !== "completed") {
        actions.append(makeButton("완료", "", function () { changeTreatmentStatus(item, "completed"); }));
      }
      if (item.status !== "cancelled") {
        actions.append(makeButton("취소", "", function () { changeTreatmentStatus(item, "cancelled"); }));
      }
      actions.append(makeButton("삭제", "danger", function () { removeTreatment(item.id); }));
      card.append(grid, actions);
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
    lines.push(latest
      ? formatDate(latest.measuredAt) +
        " · 체온 " + textOrDash(latest.temperature) +
        " · 산소포화도 " + textOrDash(latest.oxygenSaturation) +
        " · 혈압 " + textOrDash(latest.systolicBp) + "/" + textOrDash(latest.diastolicBp) +
        " · 통증 " + textOrDash(latest.painScore) +
        (latest.note ? " · 메모 " + latest.note : "")
      : "없음");
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
    renderEvents();
    renderTreatments();
    renderHandoff();
    window.CareCharts.update(state.vitals, $("#chartRange").value);
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
        window.CareApi.listEvents(),
        window.CareApi.listTreatments()
      ]);
      state.status = normalizeStatus(results[1]);
      state.handoff = normalizeHandoff(results[2]);
      state.vitals = ((results[3] && results[3].items) || []).map(normalizeVitals);
      state.events = ((results[4] && results[4].items) || []).map(normalizeEvent);
      state.treatments = ((results[5] && results[5].items) || []).map(normalizeTreatment);
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
    const bloodPressure = hasValue(data.systolicBp) || hasValue(data.diastolicBp)
      ? textOrDash(data.systolicBp) + "/" + textOrDash(data.diastolicBp)
      : null;
    return {
      measuredAt: fromLocalInput(data.measuredAt) || new Date().toISOString(),
      temperature: data.temperature,
      heartRate: data.heartRate,
      oxygenSaturation: data.oxygenSaturation,
      bloodPressure: bloodPressure,
      respiratoryRate: data.respiratoryRate,
      painScore: data.painScore,
      memo: data.note || "",
      author: author()
    };
  }

  function hasVitalsNumber(form) {
    const data = cleanNumbers(collectForm(form), ["temperature", "heartRate", "oxygenSaturation", "systolicBp", "diastolicBp", "respiratoryRate", "painScore"]);
    return ["temperature", "heartRate", "oxygenSaturation", "systolicBp", "diastolicBp", "respiratoryRate", "painScore"].some(function (field) {
      return hasValue(data[field]);
    });
  }

  function eventPayload(form) {
    const data = collectForm(form);
    return {
      occurredAt: fromLocalInput(data.occurredAt),
      category: data.category,
      title: data.title,
      content: data.detail || "",
      isImportant: Boolean(data.isImportant),
      author: author()
    };
  }

  function treatmentPayload(form) {
    const data = collectForm(form);
    return {
      scheduledAt: fromLocalInput(data.scheduledAt),
      title: data.title,
      content: data.detail || "",
      status: data.status,
      completedAt: data.status === "completed" ? new Date().toISOString() : null,
      completedBy: data.status === "completed" ? author() : null,
      author: author()
    };
  }

  function payloadFromTreatmentItem(item, status) {
    return {
      scheduledAt: item.scheduledAt,
      title: item.title || "",
      content: item.detail || "",
      status: status,
      completedAt: status === "completed" ? (item.completedAt || new Date().toISOString()) : null,
      completedBy: status === "completed" ? (item.completedBy || author()) : null,
      author: author()
    };
  }

  function upsertById(items, item) {
    const index = items.findIndex(function (existing) { return String(existing.id) === String(item.id); });
    if (index === -1) return [item].concat(items);
    const copy = items.slice();
    copy[index] = item;
    return copy;
  }

  function editVitals(item) {
    setFormValues($("#vitalsForm"), item);
    $("#saveVitalsButton").textContent = "수정 저장";
    $("#cancelVitalsEdit").hidden = false;
    window.scrollTo({ top: $("#vitalsForm").offsetTop - 90, behavior: "smooth" });
  }

  function editEvent(item) {
    setFormValues($("#eventForm"), item);
    $("#saveEventButton").textContent = "수정 저장";
    $("#cancelEventEdit").hidden = false;
    window.scrollTo({ top: $("#eventForm").offsetTop - 90, behavior: "smooth" });
  }

  function editTreatment(item) {
    setFormValues($("#treatmentForm"), item);
    $("#saveTreatmentButton").textContent = "수정 저장";
    $("#cancelTreatmentEdit").hidden = false;
    window.scrollTo({ top: $("#treatmentForm").offsetTop - 90, behavior: "smooth" });
  }

  function resetVitalsEdit() {
    resetForm($("#vitalsForm"));
    $("#saveVitalsButton").textContent = "추가";
    $("#cancelVitalsEdit").hidden = true;
    $("#vitalsForm input[name='measuredAt']").value = toLocalInput(new Date().toISOString());
  }

  function resetEventEdit() {
    resetForm($("#eventForm"));
    $("#saveEventButton").textContent = "추가";
    $("#cancelEventEdit").hidden = true;
    $("#eventForm input[name='occurredAt']").value = toLocalInput(new Date().toISOString());
  }

  function resetTreatmentEdit() {
    resetForm($("#treatmentForm"));
    $("#treatmentForm select[name='status']").value = "planned";
    $("#treatmentForm input[name='scheduledAt']").value = toLocalInput(new Date().toISOString());
    $("#saveTreatmentButton").textContent = "추가";
    $("#cancelTreatmentEdit").hidden = true;
  }

  async function removeVitals(id) {
    if (!confirm("이 활력징후 기록을 삭제할까요?")) return;
    await runWithButton(null, async function () {
      await window.CareApi.deleteVitals(id);
      state.vitals = state.vitals.filter(function (item) { return String(item.id) !== String(id); });
      renderLatestVitals();
      renderVitals();
      renderHandoff();
      window.CareCharts.update(state.vitals, $("#chartRange").value);
      showToast("활력징후 기록을 삭제했습니다.");
    });
  }

  async function removeEvent(id) {
    if (!confirm("이 이벤트 기록을 삭제할까요?")) return;
    await runWithButton(null, async function () {
      await window.CareApi.deleteEvent(id);
      state.events = state.events.filter(function (item) { return String(item.id) !== String(id); });
      renderEvents();
      renderHandoff();
      showToast("이벤트 기록을 삭제했습니다.");
    });
  }

  async function removeTreatment(id) {
    if (!confirm("이 치료 및 할 일을 삭제할까요?")) return;
    await runWithButton(null, async function () {
      await window.CareApi.deleteTreatment(id);
      state.treatments = state.treatments.filter(function (item) { return String(item.id) !== String(id); });
      renderTreatments();
      renderHandoff();
      showToast("치료 및 할 일을 삭제했습니다.");
    });
  }

  async function changeTreatmentStatus(item, status) {
    await runWithButton(null, async function () {
      const saved = normalizeTreatment(await window.CareApi.updateTreatment(item.id, payloadFromTreatmentItem(item, status)));
      state.treatments = upsertById(state.treatments, saved);
      renderTreatments();
      renderHandoff();
      showToast("상태를 변경했습니다.");
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
      const form = event.currentTarget;
      runWithButton($("#saveStatusButton"), async function () {
        const saved = await window.CareApi.saveStatus(statusPayload(form));
        state.status = normalizeStatus(saved);
        renderStatus();
        showToast("현재 상태를 저장했습니다.");
      });
    });

    $("#handoffForm").addEventListener("submit", function (event) {
      event.preventDefault();
      const data = collectForm(event.currentTarget);
      runWithButton($("#saveHandoffButton"), async function () {
        const saved = await window.CareApi.saveHandoff({ content: data.note || "" });
        state.handoff = normalizeHandoff(saved);
        renderHandoff();
        showToast("인계 메모를 저장했습니다.");
      });
    });

    $("#vitalsForm").addEventListener("submit", function (event) {
      event.preventDefault();
      const form = event.currentTarget;
      const id = form.elements.id.value;
      if (!hasVitalsNumber(form)) {
        showToast("활력징후 수치를 최소 한 개 이상 입력해주세요.", true);
        return;
      }
      const data = vitalsPayload(form);
      runWithButton($("#saveVitalsButton"), async function () {
        const saved = normalizeVitals(id
          ? await window.CareApi.updateVitals(id, data)
          : await window.CareApi.createVitals(data));
        state.vitals = upsertById(state.vitals, saved);
        resetVitalsEdit();
        renderLatestVitals();
        renderVitals();
        renderHandoff();
        window.CareCharts.update(state.vitals, $("#chartRange").value);
        showToast(id ? "활력징후 기록을 수정했습니다." : "활력징후 기록을 추가했습니다.");
      });
    });

    $("#eventForm").addEventListener("submit", function (event) {
      event.preventDefault();
      const form = event.currentTarget;
      const id = form.elements.id.value;
      const data = eventPayload(form);
      runWithButton($("#saveEventButton"), async function () {
        const saved = normalizeEvent(id
          ? await window.CareApi.updateEvent(id, data)
          : await window.CareApi.createEvent(data));
        state.events = upsertById(state.events, saved);
        resetEventEdit();
        renderEvents();
        renderHandoff();
        showToast(id ? "이벤트 기록을 수정했습니다." : "이벤트 기록을 추가했습니다.");
      });
    });

    $("#treatmentForm").addEventListener("submit", function (event) {
      event.preventDefault();
      const form = event.currentTarget;
      const id = form.elements.id.value;
      const data = treatmentPayload(form);
      runWithButton($("#saveTreatmentButton"), async function () {
        const saved = normalizeTreatment(id
          ? await window.CareApi.updateTreatment(id, data)
          : await window.CareApi.createTreatment(data));
        state.treatments = upsertById(state.treatments, saved);
        resetTreatmentEdit();
        renderTreatments();
        renderHandoff();
        showToast(id ? "치료 및 할 일을 수정했습니다." : "치료 및 할 일을 추가했습니다.");
      });
    });
  }

  function bindActions() {
    $("#refreshButton").addEventListener("click", function () { loadAll(false); });
    $("#settingsButton").addEventListener("click", showSetup);
    $("#chartRange").addEventListener("change", function () { window.CareCharts.update(state.vitals, $("#chartRange").value); });
    $("#cancelVitalsEdit").addEventListener("click", resetVitalsEdit);
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
    $("#eventForm input[name='occurredAt']").value = now;
    $("#treatmentForm input[name='scheduledAt']").value = now;
    $("#treatmentForm select[name='status']").value = "planned";
  }

  function init() {
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
