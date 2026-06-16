(function () {
  "use strict";

  const STORAGE_KEYS = {
    familyKey: "careLog.familyKey"
  };

  function getFamilyKey() {
    return localStorage.getItem(STORAGE_KEYS.familyKey) || "";
  }

  function setFamilyKey(value) {
    localStorage.setItem(STORAGE_KEYS.familyKey, value);
  }

  function baseUrl() {
    return (window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL || "").replace(/\/$/, "");
  }

  async function request(path, options) {
    const opts = options || {};
    const headers = new Headers(opts.headers || {});
    headers.set("X-Family-Key", getFamilyKey());

    if (opts.body && !(opts.body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(baseUrl() + path, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });

    if (response.status === 401) {
      const error = new Error("가족 접근 키가 올바르지 않거나 만료되었습니다.");
      error.status = 401;
      throw error;
    }

    if (!response.ok) {
      let detail = "";
      try {
        const data = await response.json();
        detail = data.detail || data.message || "";
      } catch (err) {
        detail = await response.text();
      }
      throw new Error(detail || "요청을 처리하지 못했습니다.");
    }

    if (response.status === 204) {
      return null;
    }

    const contentType = response.headers.get("Content-Type") || "";
    if (contentType.includes("application/json")) {
      return response.json();
    }
    return response.blob();
  }

  function download(path, filename) {
    return fetch(baseUrl() + path, {
      headers: {
        "X-Family-Key": getFamilyKey()
      }
    }).then(function (response) {
      if (response.status === 401) {
        const error = new Error("가족 접근 키가 올바르지 않거나 만료되었습니다.");
        error.status = 401;
        throw error;
      }
      if (!response.ok) {
        throw new Error("파일을 내려받지 못했습니다.");
      }
      return response.blob();
    }).then(function (blob) {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    });
  }

  window.CareApi = {
    getFamilyKey: getFamilyKey,
    setFamilyKey: setFamilyKey,
    health: function () { return request("/health"); },
    getStatus: function () { return request("/api/status"); },
    saveStatus: function (data) { return request("/api/status", { method: "PUT", body: data }); },
    getHandoff: function () { return request("/api/handoff"); },
    saveHandoff: function (data) { return request("/api/handoff", { method: "PUT", body: data }); },
    listVitals: function () { return request("/api/vitals"); },
    createVitals: function (data) { return request("/api/vitals", { method: "POST", body: data }); },
    updateVitals: function (id, data) { return request("/api/vitals/" + encodeURIComponent(id), { method: "PUT", body: data }); },
    deleteVitals: function (id) { return request("/api/vitals/" + encodeURIComponent(id), { method: "DELETE" }); },
    listEvents: function () { return request("/api/events"); },
    createEvent: function (data) { return request("/api/events", { method: "POST", body: data }); },
    updateEvent: function (id, data) { return request("/api/events/" + encodeURIComponent(id), { method: "PUT", body: data }); },
    deleteEvent: function (id) { return request("/api/events/" + encodeURIComponent(id), { method: "DELETE" }); },
    listTreatments: function () { return request("/api/treatments"); },
    createTreatment: function (data) { return request("/api/treatments", { method: "POST", body: data }); },
    updateTreatment: function (id, data) { return request("/api/treatments/" + encodeURIComponent(id), { method: "PUT", body: data }); },
    deleteTreatment: function (id) { return request("/api/treatments/" + encodeURIComponent(id), { method: "DELETE" }); },
    downloadExport: function () { return download("/api/export", "care-log-export.json"); },
    downloadBackup: function () { return download("/api/backup", "care-log-backup.sqlite"); }
  };
})();
