(function () {
  "use strict";

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

  function renderStatus() {
    setFormValues($("#statusForm"), state.status || {});
    const editor = state.status.updatedBy || state.status.author || "-";
    $("#statusMeta").textContent = "수정자: " + editor + " · 수정 시각: " + formatDate(state.status.updatedAt);
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
    addSummary(parent, "체온", latest.temperature ? latest.temperature + " ℃" : "-");
    addSummary(parent, "심박수", latest.heartRate ? latest.heartRate + " 회/분" : "-");
    addSummary(parent, "산소포화도", latest.oxygenSaturation ? latest.oxygenSaturation + " %" : "-");
    addSummary(parent, "혈압", latest.systolicBp && latest.diastolicBp ? latest.systolicBp + "/" + latest.diastolicBp : "-");
    addSummary(parent, "호흡수", latest.respiratoryRate ? latest.respiratoryRate + " 회/분" : "-");
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
      return new Date(b.measuredAt || b.createdAt || 0) - new Date(a.measuredAt || a.createdAt || 0);
    });
    if (!sorted.length) {
      const empty = document.createElement("p");
      empty.textContent = "활력징후 기록이 없습니다.";
      list.appendChild(empty);
      return;
    }
    sorted.forEach(function (item) {
      const card = document.createElement("article");
      card.className = "record-card";
      const title = document.createElement("div");
      title.className = "record-title";
      const h3 = document.createElement("h3");
      h3.textContent = formatDate(item.measuredAt);
      title.appendChild(h3);
      title.appendChild(makeBadge(item.author || "작성자 없음"));
      const body = document.createElement("p");
      body.textContent = [
        item.temperature ? "체온 " + item.temperature + "℃" : "",
        item.heartRate ? "심박수 " + item.heartRate : "",
        item.oxygenSaturation ? "산소포화도 " + item.oxygenSaturation + "%" : "",
        item.systolicBp && item.diastolicBp ? "혈압 " + item.systolicBp + "/" + item.diastolicBp : "",
        item.respiratoryRate ? "호흡수 " + item.respiratoryRate : "",
        item.painScore !== null && item.painScore !== undefined ? "통증 " + item.painScore : ""
      ].filter(Boolean).join(" · ") || "수치 없음";
      const note = document.createElement("p");
      note.textContent = item.note || "";
      const actions = document.createElement("div");
      actions.className = "record-actions";
      actions.append(
        makeButton("수정", "", function () { editVitals(item); }),
        makeButton("삭제", "danger", function () { removeVitals(item.id); })
      );
      card.append(title, body, note, actions);
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
      const card = document.createElement("article");
      card.className = "record-card";
      const title = document.createElement("div");
      title.className = "record-title";
      const h3 = document.createElement("h3");
      h3.textContent = item.title || "제목 없음";
      title.appendChild(h3);
      title.appendChild(makeBadge(item.category || "기타", item.isImportant ? "important" : ""));
      const meta = document.createElement("p");
      meta.textContent = formatDate(item.occurredAt) + " · " + (item.author || "작성자 없음") + (item.isImportant ? " · 중요 기록" : "");
      const detail = document.createElement("p");
      detail.textContent = item.detail || "";
      const actions = document.createElement("div");
      actions.className = "record-actions";
      actions.append(
        makeButton("수정", "", function () { editEvent(item); }),
        makeButton("삭제", "danger", function () { removeEvent(item.id); })
      );
      card.append(title, meta, detail, actions);
      list.appendChild(card);
    });
  }

  function renderTreatments() {
    const list = $("#treatmentList");
    list.replaceChildren();
    const sorted = state.treatments.slice().sort(function (a, b) {
      return new Date(a.scheduledAt || 0) - new Date(b.scheduledAt || 0);
    });
    if (!sorted.length) {
      const empty = document.createElement("p");
      empty.textContent = "치료 및 할 일이 없습니다.";
      list.appendChild(empty);
      return;
    }
    sorted.forEach(function (item) {
      const card = document.createElement("article");
      card.className = "record-card";
      const title = document.createElement("div");
      title.className = "record-title";
      const h3 = document.createElement("h3");
      h3.textContent = item.title || "제목 없음";
      title.appendChild(h3);
      title.appendChild(makeBadge(treatmentStatuses[item.status] || item.status || "예정", item.status || ""));
      const meta = document.createElement("p");
      meta.textContent = formatDate(item.scheduledAt) + " · " + (item.author || "작성자 없음");
      const detail = document.createElement("p");
      detail.textContent = item.detail || "";
      const actions = document.createElement("div");
      actions.className = "record-actions";
      actions.append(
        makeButton("수정", "", function () { editTreatment(item); }),
        makeButton("완료", "", function () { changeTreatmentStatus(item, "completed"); }),
        makeButton("취소", "", function () { changeTreatmentStatus(item, "cancelled"); }),
        makeButton("삭제", "danger", function () { removeTreatment(item.id); })
      );
      card.append(title, meta, detail, actions);
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
      state.status = results[1] || {};
      state.handoff = results[2] || {};
      state.vitals = (results[3] && results[3].items) || [];
      state.events = (results[4] && results[4].items) || [];
      state.treatments = (results[5] && results[5].items) || [];
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
    delete data.id;
    return data;
  }

  function hasVitalsNumber(data) {
    return ["temperature", "heartRate", "oxygenSaturation", "systolicBp", "diastolicBp", "respiratoryRate", "painScore"].some(function (field) {
      return data[field] !== null && data[field] !== undefined && data[field] !== "";
    });
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
  }

  function editTreatment(item) {
    setFormValues($("#treatmentForm"), item);
    $("#saveTreatmentButton").textContent = "수정 저장";
    $("#cancelTreatmentEdit").hidden = false;
  }

  function resetVitalsEdit() {
    resetForm($("#vitalsForm"));
    $("#saveVitalsButton").textContent = "추가";
    $("#cancelVitalsEdit").hidden = true;
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
