import { Router } from "../../../ui/navigation/router.js";
import { installWebAudioCorsBypass, initAudioDecodingMonitor } from "./webAudioMediaBypass.js";
import { installWebProfilePinEngine } from "./webProfilePinStorage.js";
import { initWebRouterHistory } from "./webRouterHistory.js";
import {
  getActivePlayerScreen,
  patchPlayerScreenIfNeeded,
  ensureDesktopPlayerControls,
  syncFullscreenUi
} from "./webDesktopPlayerUi.js";
import { attachBrowserInputListeners, ensureSearchInputClearButton } from "./webInputEvents.js";

// Top-level side effects required when running in browser mode
installWebAudioCorsBypass();
installWebProfilePinEngine();

function injectWebBrowserStylesheet() {
  if (typeof document === "undefined") return;
  if (document.querySelector("link[data-web-browser-css]")) return;

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "css/web-browser.css";
  link.setAttribute("data-web-browser-css", "true");
  document.head.appendChild(link);
}

let initialized = false;

export function initWebInputAdapter() {
  if (initialized) return;
  initialized = true;

  if (typeof document === "undefined") return;

  document.documentElement.classList.add("platform-browser");
  document.body?.classList?.add("platform-browser");

  injectWebBrowserStylesheet();
  initAudioDecodingMonitor();
  attachBrowserInputListeners();

  document.addEventListener("fullscreenchange", () => {
    syncFullscreenUi();
  });

  initWebRouterHistory();

  try {
    patchPlayerScreenIfNeeded(Router.routes?.player);
    let checkPending = false;
    const checkDomElements = () => {
      checkPending = false;
      const ps = getActivePlayerScreen();
      if (ps) {
        patchPlayerScreenIfNeeded(ps);
        ensureDesktopPlayerControls(ps);
      }
      ensureSearchInputClearButton();
    };

    const observer = new MutationObserver((mutations) => {
      if (checkPending) return;
      for (const m of mutations) {
        if (m.addedNodes.length > 0) {
          checkPending = true;
          requestAnimationFrame(checkDomElements);
          break;
        }
      }
    });
    const targetRoot = document.getElementById("app") || document.body;
    observer.observe(targetRoot, { childList: true, subtree: true });
  } catch (_) {}
}

if (typeof document !== "undefined") {
  try {
    initWebInputAdapter();
  } catch (_) {}
}
