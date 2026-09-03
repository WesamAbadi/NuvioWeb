/* global module, require, process */
"use strict";

var SERVICE_TAG = "[Nuvio PluginService]";
var DEFAULT_PORT = 2711;
var FALLBACK_PORT = 11471;

function runtimeProcess() {
  try {
    return typeof process !== "undefined" && process ? process : null;
  } catch (_) {
    return null;
  }
}

function runtimeEnv(name) {
  var currentProcess = runtimeProcess();
  return currentProcess && currentProcess.env ? currentProcess.env[name] : null;
}

var configuredPort = normalizePort(runtimeEnv("NUVIO_PLUGIN_SERVICE_PORT"), DEFAULT_PORT);
var candidates = [configuredPort];
if (FALLBACK_PORT !== configuredPort) candidates.push(FALLBACK_PORT);
var candidateIndex = 0;
var server = null;
var activePort = 0;
var startRequested = false;
var lifecycleToken = 0;

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

function normalizePort(value, fallback) {
  var parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1024 && parsed <= 65535 ? parsed : fallback;
}

function errorText(error) {
  return error && error.stack ? error.stack : String(error || "Unknown plugin service error");
}

function closeServer(target) {
  if (!target || typeof target.close !== "function") return;
  try {
    target.close();
  } catch (_) {
    // A server that failed during listen may already be closed.
  }
}

function probeNodeRuntime() {
  // The lightweight Tizen Web Service runtime only needs http to expose the
  // health endpoint. plugin-http.cjs loads url/net/dns/https/zlib lazily for
  // individual requests, so an unavailable optional module must not prevent
  // the service from binding and being discoverable by the app.
  diagnostic("runtime probe begin", { requiredModules: ["http"] });
  try {
    var http = require("http");
    if (typeof http.createServer !== "function") {
      throw new Error("http.createServer is unavailable");
    }
    diagnostic("runtime probe success", { httpCreateServer: true });
  } catch (error) {
    diagnostic("runtime probe failed", { error: diagnosticError(error) });
    throw error;
  }
}

function probeExistingPluginService(port, callback) {
  var http;
  try {
    http = require("http");
  } catch (_) {
    callback(false);
    return;
  }
  if (!http || typeof http.request !== "function") {
    callback(false);
    return;
  }

  var settled = false;
  var request = null;
  function finish(isPluginService) {
    if (settled) return;
    settled = true;
    diagnostic("existing service probe result", {
      port: port,
      compatible: isPluginService === true
    });
    callback(isPluginService === true);
  }

  try {
    request = http.request(
      {
        host: "127.0.0.1",
        port: port,
        path: "/health",
        method: "GET"
      },
      function (response) {
        var body = "";
        response.on("data", function (chunk) {
          if (body.length < 8192) body += String(chunk);
        });
        response.on("end", function () {
          if (response.statusCode !== 200) {
            finish(false);
            return;
          }
          try {
            var payload = JSON.parse(body || "{}");
            finish(
              payload &&
                payload.returnValue === true &&
                payload.service === "nuvio-plugin-network" &&
                Number(payload.protocolVersion || 0) === 1
            );
          } catch (_) {
            finish(false);
          }
        });
        response.on("error", function () {
          finish(false);
        });
      }
    );
    request.on("error", function () {
      finish(false);
    });
    if (typeof request.setTimeout === "function") {
      request.setTimeout(700, function () {
        try {
          request.destroy();
        } catch (_) {}
        finish(false);
      });
    }
    request.end();
  } catch (_) {
    finish(false);
  }
}

function failStart(token, error) {
  if (token !== lifecycleToken) return;
  startRequested = false;
  activePort = 0;
  if (server) {
    closeServer(server);
    server = null;
  }
  diagnostic("startup failed", { error: diagnosticError(error) });
  console.error(SERVICE_TAG + " failed to listen", errorText(error));
}

function bindCandidate(token, pluginHttp) {
  if (token !== lifecycleToken) return;
  if (candidateIndex >= candidates.length) {
    failStart(token, new Error("No available local plugin service port"));
    return;
  }

  var candidate = candidates[candidateIndex];
  var localServer;
  diagnostic("bind attempt", {
    port: candidate,
    candidateIndex: candidateIndex,
    candidates: candidates.slice()
  });
  try {
    localServer = pluginHttp.createPluginHttpServer({ port: candidate });
    if (!localServer || typeof localServer.listen !== "function") {
      throw new Error("Plugin HTTP server is unavailable");
    }
    diagnostic("server factory success", { port: candidate });
  } catch (error) {
    diagnostic("server factory failed", { port: candidate, error: diagnosticError(error) });
    failStart(token, error);
    return;
  }

  server = localServer;
  var listening = false;
  var handled = false;
  function markListening() {
    if (token !== lifecycleToken || handled) {
      closeServer(localServer);
      return;
    }
    listening = true;
    activePort = candidate;
    diagnostic("server listening", { port: candidate, loopback: "127.0.0.1" });
  }
  function handleBindError(error) {
    if (token !== lifecycleToken) {
      closeServer(localServer);
      return;
    }
    if (listening) {
      console.error(SERVICE_TAG + " server error", errorText(error));
      return;
    }
    if (handled) return;
    handled = true;
    diagnostic("server bind error", {
      port: candidate,
      error: diagnosticError(error),
      hasFallback: candidateIndex < candidates.length - 1
    });
    closeServer(localServer);
    server = null;
    if (error && error.code === "EADDRINUSE") {
      probeExistingPluginService(candidate, function (isExistingPluginService) {
        if (token !== lifecycleToken) return;
        if (isExistingPluginService) {
          activePort = candidate;
          diagnostic("compatible existing service reused", { port: candidate });
          console.warn(
            SERVICE_TAG +
              " port " +
              candidate +
              " is already served by a compatible PluginService; reusing it"
          );
          return;
        }
        if (candidateIndex < candidates.length - 1) {
          candidateIndex += 1;
          diagnostic("fallback port selected", {
            previousPort: candidate,
            nextPort: candidates[candidateIndex]
          });
          console.warn(
            SERVICE_TAG +
              " port " +
              candidate +
              " is already in use; trying 127.0.0.1:" +
              candidates[candidateIndex]
          );
          bindCandidate(token, pluginHttp);
          return;
        }
        failStart(token, error);
      });
      return;
    }
    failStart(token, error);
  }
  localServer.on("listening", markListening);
  localServer.on("error", handleBindError);

  try {
    // Keep the exact one-argument overload used by the working EngineFS
    // runtime. Some Tizen lightweight runtimes acknowledge the host/callback
    // overload without creating a reachable loopback listener.
    localServer.listen(candidate);
    diagnostic("listen called", { port: candidate, argumentCount: 1 });
  } catch (error) {
    handleBindError(error);
  }
}

function start() {
  if (startRequested) {
    diagnostic("onStart ignored", { reason: "start already requested", activePort: activePort });
    return;
  }

  startRequested = true;
  candidateIndex = 0;
  activePort = 0;
  var token = ++lifecycleToken;
  var currentProcess = runtimeProcess();
  diagnostic("onStart", {
    candidates: candidates.slice(),
    configuredPort: configuredPort,
    nodeVersion:
      currentProcess && currentProcess.version ? String(currentProcess.version) : "unknown"
  });
  try {
    probeNodeRuntime();
    diagnostic("plugin-http load begin", { module: "../plugin-http.cjs" });
    var pluginHttp = require("../plugin-http.cjs");
    if (!pluginHttp || typeof pluginHttp.createPluginHttpServer !== "function") {
      throw new Error("Plugin HTTP implementation is unavailable");
    }
    diagnostic("plugin-http load success", { createPluginHttpServer: true });
    bindCandidate(token, pluginHttp);
  } catch (error) {
    diagnostic("onStart failed before bind", { error: diagnosticError(error) });
    failStart(token, error);
  }
}

function stop() {
  var previousPort = activePort;
  lifecycleToken += 1;
  startRequested = false;
  candidateIndex = 0;
  activePort = 0;
  var current = server;
  server = null;
  closeServer(current);
  diagnostic("onExit", { closed: Boolean(current), previousPort: previousPort });
}

// Tizen Web Service applications are entered through onStart. Keeping the
// server out of module evaluation makes startup, failure reporting and
// shutdown follow the same lifecycle as the working EngineFS service.
module.exports.onStart = start;
module.exports.onExit = stop;
// Compatibility alias for older Tizen service runtimes.
module.exports.onStop = stop;
