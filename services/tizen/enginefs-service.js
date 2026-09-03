/* global module, require, process */
"use strict";

var SERVICE_TAG = "[Nuvio Tizen EngineFS]";
var started = false;

function warn() {
  var args = Array.prototype.slice.call(arguments);
  args.unshift(SERVICE_TAG);
  console.warn.apply(console, args);
}

function diagnosticError(error) {
  var details = {
    name: error && error.name ? String(error.name) : "Error",
    message: error && error.message ? String(error.message) : String(error || "Unknown error")
  };
  if (error && error.code) details.code = String(error.code);
  if (error && error.stack) details.stack = String(error.stack).slice(0, 1600);
  return details;
}

function diagnostic() {
  // Diagnostic console output is intentionally disabled in normal builds.
}

function probeNodeRuntime() {
  var requiredModules = [
    "fs",
    "http",
    "net",
    "dgram",
    "stream",
    "events",
    "path",
    "url",
    "crypto",
    "buffer"
  ];
  var missing = [];
  var loaded = [];
  requiredModules.forEach(function (moduleName) {
    try {
      require(moduleName);
      loaded.push(moduleName);
    } catch (error) {
      missing.push(moduleName + ": " + (error && error.message ? error.message : String(error)));
    }
  });
  diagnostic("runtime probe", {
    requiredModules: requiredModules,
    loadedModules: loaded,
    missingModules: missing
  });
  if (missing.length) {
    var missingError = new Error("Missing Node-compatible modules: " + missing.join("; "));
    diagnostic("runtime probe failed", { error: diagnosticError(missingError) });
    throw missingError;
  }

  var http = require("http");
  var net = require("net");
  var dgram = require("dgram");
  if (typeof http.createServer !== "function") {
    throw new Error("http.createServer is unavailable");
  }
  if (typeof net.createServer !== "function") {
    throw new Error("net.createServer is unavailable");
  }
  if (typeof dgram.createSocket !== "function") {
    throw new Error("dgram.createSocket is unavailable");
  }
  diagnostic("runtime probe success", {
    httpCreateServer: true,
    netCreateServer: true,
    dgramCreateSocket: true
  });
}

function configureRuntimeEnv() {
  process.argv = Array.isArray(process.argv)
    ? process.argv
    : ["nuvio-enginefs-service", "runtime/media-http.cjs"];
  process.env = process.env || {};
  if (!process.env.HOME) {
    try {
      process.env.HOME = process.cwd ? process.cwd() : ".";
    } catch (_) {
      process.env.HOME = ".";
    }
  }
  try {
    if (!process.execPath) {
      process.execPath = process.env.HOME;
    }
  } catch (_) {
    // Some runtimes may expose process.execPath as read-only.
  }
  process.env.PORT = process.env.PORT || "2710";
  process.env.NO_CORS = "1";
  process.env.NO_HTTPS_SERVER = "1";
  process.env.HLS_V2_DISABLED = "1";
  process.env.CASTING_DISABLED = "1";
  process.env.LOCAL_ADDON_DISABLED = "1";
  process.env.NO_NETWORK_INTERFACES = process.env.NO_NETWORK_INTERFACES || "";
  diagnostic("runtime environment configured", {
    port: process.env.PORT,
    noCors: process.env.NO_CORS,
    noHttpsServer: process.env.NO_HTTPS_SERVER,
    hlsV2Disabled: process.env.HLS_V2_DISABLED,
    castingDisabled: process.env.CASTING_DISABLED,
    localAddonDisabled: process.env.LOCAL_ADDON_DISABLED
  });
}

function startEngineFsRuntime() {
  if (started) {
    diagnostic("start ignored", { reason: "runtime already requested" });
    return;
  }
  diagnostic("start begin", { runtimeModule: "./runtime/media-http.cjs" });
  probeNodeRuntime();
  configureRuntimeEnv();
  started = true;
  require("./runtime/media-http.cjs");
  diagnostic("EngineFS runtime module loaded", { port: process.env.PORT });
  // AVPlay can expose text tracks without rendering them. Keep the fallback
  // extractors beside the existing runtime so Tizen 4+ devices with the
  // packaged web service can render supported timed text through the app HTML
  // overlay. Devices that cannot start the service retain native fallback.
  require("./runtime/tx3g-subtitle-service.cjs").start();
  diagnostic("subtitle service start requested", { port: process.env.PORT });
}

function requestRemoveAll() {
  try {
    var http = require("http");
    var port = Number(process.env.PORT || 2710) || 2710;
    http
      .get("http://127.0.0.1:" + port + "/removeAll", function (response) {
        response.resume();
      })
      .on("error", function () {});
  } catch (_) {
    // Service shutdown cleanup is best-effort.
  }
}

module.exports.onStart = function () {
  diagnostic("onStart", { service: "EngineFsService" });
  try {
    startEngineFsRuntime();
  } catch (error) {
    started = false;
    diagnostic("onStart failed", { error: diagnosticError(error) });
    warn("local EngineFS runtime failed to start", error && error.stack ? error.stack : error);
  }
};

function stopEngineFsRuntime() {
  diagnostic("onExit", { service: "EngineFsService", port: process.env.PORT || "2710" });
  try {
    require("./runtime/tx3g-subtitle-service.cjs").stop();
  } catch (_) {}
  requestRemoveAll();
}

// onExit is the documented Tizen Web Service lifecycle callback. Keep onStop
// as a harmless compatibility alias for older service runtimes.
module.exports.onExit = stopEngineFsRuntime;
module.exports.onStop = stopEngineFsRuntime;
