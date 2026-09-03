import { Platform } from "../index.js";
import { TizenCapabilities } from "./tizenCapabilities.js";

const LOCAL_BASE_URLS = [
  "http://127.0.0.1:2711",
  "http://localhost:2711",
  "http://127.0.0.1:11471",
  "http://localhost:11471"
];
const START_TIMEOUT_MS = 12000;
const PROBE_TIMEOUT_MS = 2500;
const SERVICE_START_CALL_TIMEOUT_MS = 4000;
// A Web Service start acknowledgement only means that Tizen queued the
// service. Give the lightweight runtime enough time to initialize on a cold
// TV boot, while keeping the same overall startup budget as EngineFS.
const DEFAULT_OPERATION = "http://tizen.org/appcontrol/operation/default";
const PLUGIN_SERVICE_NAME = "nuvio-plugin-network";
const PLUGIN_PROTOCOL_VERSION = 1;
let startPromise = null;
let wrtServiceModulePromise = null;

function diagnosticError(error) {
  const details = {
    name: String(error?.name || "Error"),
    message: String(error?.message || error || "Unknown error")
  };
  if (error?.code) details.code = String(error.code);
  if (error?.stack) details.stack = String(error.stack).slice(0, 1600);
  return details;
}

function diagnostic() {
  // Diagnostic console output is intentionally disabled in normal builds.
}

function resultSummary(value) {
  if (value === undefined) return { resultType: "undefined" };
  if (value === null) return { resultType: "null" };
  if (typeof value !== "object") return { resultType: typeof value };
  let keys = [];
  try {
    keys = Object.keys(value).slice(0, 16);
  } catch (_) {
    keys = [];
  }
  return { resultType: "object", resultKeys: keys };
}

function withTimeout(promise, timeoutMs, message) {
  let timer = 0;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function getServiceId() {
  const configured = String(globalThis.__NUVIO_TIZEN_PLUGIN_SERVICE_ID__ || "").trim();
  if (configured) {
    return configured;
  }
  try {
    const appInfo = globalThis.tizen?.application?.getCurrentApplication?.()?.appInfo;
    const packageId = String(appInfo?.packageId || "").trim();

    if (packageId) {
      return `${packageId}.PluginService`;
    }

    const appId = String(appInfo?.id || "").trim();
    return appId ? `${appId}.PluginService` : "";
  } catch (_) {
    return "";
  }
}

function callbackCall(fn, args = []) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const success = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const failure = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    try {
      const result = fn(...args, success, failure);
      if (!settled && result !== undefined) resolve(result);
    } catch (error) {
      failure(error);
    }
  });
}

async function startWithApplicationControl(id) {
  const application = globalThis.tizen?.application;
  const ApplicationControl = globalThis.tizen?.ApplicationControl;
  if (!application?.launchAppControl || typeof ApplicationControl !== "function") {
    diagnostic("application-control API unavailable", {
      serviceId: id,
      launchAppControl: typeof application?.launchAppControl,
      applicationControl: typeof ApplicationControl
    });
    throw new Error("Tizen application control API unavailable");
  }
  diagnostic("application-control start call", { serviceId: id, operation: DEFAULT_OPERATION });
  const control = new ApplicationControl(DEFAULT_OPERATION);
  return callbackCall(application.launchAppControl.bind(application), [control, id]);
}

async function startWithApplication(id) {
  const application = globalThis.tizen?.application;
  if (!application?.launch) {
    diagnostic("application launch API unavailable", {
      serviceId: id,
      launch: typeof application?.launch
    });
    throw new Error("Tizen application launch API unavailable");
  }
  diagnostic("application launch call", { serviceId: id });
  return callbackCall(application.launch.bind(application), [id]);
}

function normalizeWrtServiceModule(moduleValue) {
  const candidates = [
    moduleValue,
    moduleValue?.default,
    moduleValue?.service,
    moduleValue?.default?.service
  ];
  for (const candidate of candidates) {
    if (
      candidate &&
      (typeof candidate.startService === "function" || typeof candidate.start === "function")
    ) {
      return candidate;
    }
  }
  return null;
}

async function loadWrtServiceModule() {
  const globalService =
    globalThis.__NUVIO_TIZEN_WRT_SERVICE__ ||
    globalThis.wrt?.service ||
    globalThis.webapis?.wrt?.service ||
    globalThis.webapis?.service;
  const normalizedGlobalService = normalizeWrtServiceModule(globalService);
  if (normalizedGlobalService) {
    diagnostic("wrt service resolved from global", {
      hasStartService: typeof normalizedGlobalService.startService === "function",
      hasStartAlias: typeof normalizedGlobalService.start === "function"
    });
    return normalizedGlobalService;
  }
  if (!wrtServiceModulePromise) {
    diagnostic("wrt service dynamic import begin", { specifier: "wrt:service" });
    wrtServiceModulePromise = (async () => {
      try {
        // Keep the dynamic import out of the bundle's parse path so older
        // Tizen engines can still use the application/legacy fallbacks.
        const dynamicImport = Function("specifier", "return import(specifier);");
        const moduleValue = normalizeWrtServiceModule(await dynamicImport("wrt:service"));
        diagnostic("wrt service dynamic import result", {
          available: Boolean(moduleValue),
          hasStartService: Boolean(moduleValue?.startService),
          hasStartAlias: Boolean(moduleValue?.start)
        });
        return moduleValue;
      } catch (error) {
        diagnostic("wrt service dynamic import failed", { error: diagnosticError(error) });
        return null;
      }
    })();
  }
  return wrtServiceModulePromise;
}

async function startWithWrtService(id, { onVariant } = {}) {
  const service = await loadWrtServiceModule();
  if (!service) {
    diagnostic("wrt service API unavailable", { serviceId: id });
    throw new Error("Tizen wrt:service API unavailable");
  }
  if (typeof service.startService === "function") {
    try {
      onVariant?.("string");
      diagnostic("wrt startService call", { serviceId: id, argumentType: "string" });
      return await callbackCall(service.startService.bind(service), [id]);
    } catch (firstError) {
      onVariant?.("string-failed", firstError);
      onVariant?.("object");
      diagnostic("wrt startService string variant failed", {
        serviceId: id,
        error: diagnosticError(firstError),
        retryArgumentType: "object"
      });
      return callbackCall(service.startService.bind(service), [{ id }]);
    }
  }
  if (typeof service.start === "function") {
    onVariant?.("start-alias");
    diagnostic("wrt start alias call", { serviceId: id });
    return callbackCall(service.start.bind(service), [id]);
  }
  diagnostic("wrt service start API unavailable", { serviceId: id });
  throw new Error("Tizen service start API unavailable");
}

function getStartAttempts(id, webServiceSupported) {
  const compatibleAttempts = [
    {
      method: "tizen-application-control-default",
      start: () => startWithApplicationControl(id)
    },
    {
      method: "tizen-application-launch",
      start: () => startWithApplication(id)
    },
    {
      method: "wrt-service-legacy",
      start: () => startWithWrtService(id)
    }
  ];
  // Samsung warns that application-control launches can disturb the
  // foreground app when web.service is reported as unavailable. Use the
  // same launch-API compatibility order as EngineFS. The two services remain
  // independent: a PluginService failure never starts or stops EngineFS.
  const attempts =
    webServiceSupported === false
      ? compatibleAttempts.slice(2, 3).concat(compatibleAttempts.slice(1, 2))
      : compatibleAttempts;
  diagnostic("launcher attempts selected", {
    serviceId: id,
    webServiceSupported,
    methods: attempts.map((attempt) => attempt.method)
  });
  return attempts;
}

async function requestServiceStart(serviceId, webServiceSupported = null) {
  const errors = [];
  const attempts = getStartAttempts(serviceId, webServiceSupported);
  diagnostic("startup sequence begin", {
    serviceId,
    webServiceSupported,
    methods: attempts.map((attempt) => attempt.method)
  });

  for (const attempt of attempts) {
    diagnostic("launcher attempt begin", { serviceId, method: attempt.method });
    try {
      const startResult = await withTimeout(
        attempt.start(),
        SERVICE_START_CALL_TIMEOUT_MS,
        `${attempt.method} service start call timed out`
      );
      diagnostic("launcher acknowledged", {
        serviceId,
        method: attempt.method,
        ...resultSummary(startResult)
      });
      return { method: attempt.method };
    } catch (error) {
      const message = `${serviceId} ${attempt.method} start failed: ${String(
        error?.message || error
      )}`;
      errors.push(message);
      diagnostic("launcher attempt failed", {
        serviceId,
        method: attempt.method,
        error: diagnosticError(error)
      });
      console.warn(`[Nuvio PluginService] ${message}`);
    }
  }

  diagnostic("startup sequence failed", { errors });
  throw new Error(errors.join("; "));
}

async function requestJson(url, options = {}, timeoutMs = PROBE_TIMEOUT_MS) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeout = setTimeout(() => controller?.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      cache: "no-store",
      signal: controller?.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Tizen plugin service HTTP ${response.status}`);
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function probe(baseUrl, timeoutMs = PROBE_TIMEOUT_MS) {
  const payload = await requestJson(`${baseUrl}/health`, {}, timeoutMs);
  if (
    payload?.returnValue !== true ||
    payload?.service !== PLUGIN_SERVICE_NAME ||
    Number(payload?.protocolVersion || 0) !== PLUGIN_PROTOCOL_VERSION
  ) {
    throw new Error("Tizen plugin service health is incompatible");
  }
  return { baseUrl, payload };
}

async function findBaseUrl(timeoutMs = PROBE_TIMEOUT_MS) {
  const results = await Promise.all(
    LOCAL_BASE_URLS.map(async (baseUrl) => {
      try {
        return { baseUrl, result: await probe(baseUrl, timeoutMs) };
      } catch (error) {
        return { baseUrl, error };
      }
    })
  );
  diagnostic("health probe round", {
    timeoutMs,
    probes: results.map((entry) => ({
      baseUrl: entry.baseUrl,
      status: entry.result ? "reachable" : "failed",
      error: entry.error ? String(entry.error?.message || entry.error) : ""
    }))
  });
  const reachable = results.find((entry) => entry.result);
  if (reachable) {
    return reachable.result;
  }

  const details = results
    .map((entry) => `${entry.baseUrl}: ${String(entry.error?.message || entry.error || "failed")}`)
    .join("; ");
  throw new Error(details || "No Tizen plugin service responded");
}

async function waitForBaseUrl(timeoutMs = START_TIMEOUT_MS) {
  const startedAt = Date.now();
  let lastError = null;
  diagnostic("health wait begin", { timeoutMs });
  while (Date.now() - startedAt < timeoutMs) {
    const remaining = timeoutMs - (Date.now() - startedAt);
    if (remaining <= 0) break;
    try {
      const reachable = await findBaseUrl(Math.min(1200, remaining));
      diagnostic("health wait success", {
        elapsedMs: Date.now() - startedAt,
        baseUrl: reachable.baseUrl
      });
      return reachable;
    } catch (error) {
      lastError = error;
      const delay = Math.min(350, timeoutMs - (Date.now() - startedAt));
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  diagnostic("health wait failed", {
    elapsedMs: Date.now() - startedAt,
    error: diagnosticError(lastError || new Error("health wait timeout"))
  });
  throw lastError || new Error("Timed out waiting for the Tizen plugin service");
}

export const TizenPluginService = {
  getLocalBaseUrls() {
    return [...LOCAL_BASE_URLS];
  },

  async ensureStarted() {
    if (!Platform.isTizen()) {
      diagnostic("ensure skipped", { reason: "not running on Tizen" });
      return { status: "unsupported", detail: "Not running on Tizen" };
    }
    if (globalThis.__NUVIO_TIZEN_PLUGIN_SERVICE_ENABLED__ === false) {
      diagnostic("ensure skipped", { reason: "plugin service not packaged" });
      return { status: "unsupported", detail: "Plugin service is not packaged" };
    }
    const capabilities = TizenCapabilities.get();
    const serviceId = getServiceId();
    diagnostic("ensure begin", {
      serviceId,
      localBaseUrls: LOCAL_BASE_URLS,
      capabilities: {
        isTizen: capabilities.isTizen,
        tizenVersion: capabilities.tizenVersion || "",
        tizenMajorVersion: capabilities.tizenMajorVersion || 0,
        chromiumMajorVersion: capabilities.chromiumMajorVersion || 0,
        hasWebAssembly: capabilities.hasWebAssembly,
        webServiceSupported: capabilities.webServiceSupported,
        engineFsServicePackaged: capabilities.engineFsServicePackaged,
        pluginServicePackaged: globalThis.__NUVIO_TIZEN_PLUGIN_SERVICE_ENABLED__ !== false
      }
    });
    if (!capabilities.isTizen || !capabilities.hasWebAssembly) {
      diagnostic("ensure skipped", {
        reason: "Tizen WebAssembly unavailable",
        isTizen: capabilities.isTizen,
        hasWebAssembly: capabilities.hasWebAssembly
      });
      return { status: "unsupported", detail: "Tizen WebAssembly is unavailable" };
    }
    try {
      const reachable = await findBaseUrl();
      diagnostic("ensure found existing service", { baseUrl: reachable.baseUrl });
      return { status: "success", ...reachable, started: false };
    } catch (error) {
      // Start below.
      diagnostic("ensure existing service unavailable", { error: diagnosticError(error) });
    }
    if (!startPromise) {
      startPromise = (async () => {
        diagnostic("explicit startup requested", { serviceId });
        try {
          if (!serviceId) {
            throw new Error("Tizen plugin service id is unavailable");
          }
          const startResult = await requestServiceStart(
            serviceId,
            capabilities.webServiceSupported
          );
          const reachable = await waitForBaseUrl();
          diagnostic("explicit startup success", {
            serviceId,
            method: startResult.method,
            baseUrl: reachable.baseUrl
          });
          return {
            ...reachable,
            serviceId,
            method: startResult.method,
            startMethod: startResult.method
          };
        } catch (error) {
          diagnostic("explicit startup failed", { error: diagnosticError(error) });
          throw new Error(`${serviceId}: ${String(error?.message || error)}`);
        }
      })().finally(() => {
        startPromise = null;
      });
    }
    try {
      const result = await startPromise;
      diagnostic("ensure success", {
        serviceId: result.serviceId,
        method: result.method,
        baseUrl: result.baseUrl,
        started: true
      });
      return { status: "success", ...result, started: true };
    } catch (error) {
      const detail = String(error?.message || error);
      const runtime =
        `tizen=${capabilities.tizenVersion || "unknown"}, ` +
        `chromium=${capabilities.chromiumMajorVersion || "unknown"}, ` +
        `web.service=${String(capabilities.webServiceSupported ?? "unknown")}`;
      const diagnosticDetail = `${detail} [${runtime}]`;
      diagnostic("ensure failed", { error: diagnosticError(error), runtime });
      console.error(`[Nuvio PluginService] startup failed: ${diagnosticDetail}`);
      return { status: "error", detail: diagnosticDetail };
    }
  },

  async health() {
    diagnostic("health API requested", {});
    const started = await this.ensureStarted();
    if (started.status !== "success") {
      diagnostic("health API unavailable", { detail: started.detail || "" });
      return { returnValue: false, ...started };
    }
    const result = { returnValue: true, ...started, ...(started.payload || {}) };
    diagnostic("health API result", {
      baseUrl: started.baseUrl,
      returnValue: result.returnValue,
      service: result.service,
      protocolVersion: result.protocolVersion
    });
    return result;
  },

  async capabilities() {
    diagnostic("capabilities API requested", {});
    const started = await this.ensureStarted();
    if (started.status !== "success") {
      diagnostic("capabilities API unavailable", { detail: started.detail || "" });
      return { returnValue: false, ...started };
    }
    return requestJson(`${started.baseUrl}/capabilities`, {}, PROBE_TIMEOUT_MS);
  },

  async diagnostics() {
    diagnostic("diagnostics API requested", {});
    const started = await this.ensureStarted();
    if (started.status !== "success") {
      diagnostic("diagnostics API unavailable", { detail: started.detail || "" });
      return { returnValue: false, ...started };
    }
    return requestJson(`${started.baseUrl}/diagnostics`, {}, PROBE_TIMEOUT_MS);
  },

  async request(method, payload = {}, { timeoutMs = 30000, signal } = {}) {
    const started = await this.ensureStarted();
    if (started.status !== "success")
      throw new Error(started.detail || "Tizen plugin service unavailable");
    const baseUrl = started.baseUrl;
    diagnostic("service request begin", {
      method,
      baseUrl,
      timeoutMs,
      hasSignal: Boolean(signal)
    });
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const abort = () => controller?.abort();
    signal?.addEventListener?.("abort", abort, { once: true });
    const timer = setTimeout(abort, timeoutMs);
    try {
      const response = await fetch(`${baseUrl}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
        signal: controller?.signal
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.returnValue === false)
        throw new Error(result.errorText || `Tizen plugin service HTTP ${response.status}`);
      diagnostic("service request success", {
        method,
        baseUrl,
        httpStatus: response.status,
        returnValue: result.returnValue
      });
      return result;
    } catch (error) {
      diagnostic("service request failed", {
        method,
        baseUrl,
        error: diagnosticError(error)
      });
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", abort);
    }
  },

  fetch(payload, options) {
    return this.request("fetch", payload, options);
  },

  cancel(payload) {
    return this.request("cancel", payload, { timeoutMs: 2000 }).catch(() => false);
  },

  clearCache() {
    return this.request("cache/clear", {}, { timeoutMs: 5000 });
  }
};
