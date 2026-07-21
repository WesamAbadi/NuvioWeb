import { Router } from "../../../ui/navigation/router.js";
import { FocusEngine } from "../../../ui/navigation/focusEngine.js";
import { Platform } from "../../index.js";
import { PlayerController } from "../../../core/player/playerController.js";
import { ProfileSyncService } from "../../../core/profile/profileSyncService.js";
import { ProfileSelectionScreen } from "../../../core/profile/profileSelectionScreen.js";
import { AuthManager } from "../../../core/auth/authManager.js";
import {
  setModernSidebarExpanded,
  setLegacySidebarExpanded
} from "../../../ui/components/sidebarNavigation.js";

// Bypass WebAudio MediaElementSource capture on HTMLMediaElement in browser mode
// to prevent Chrome CORS MediaElementAudioSource zero-audio restrictions completely.
if (typeof window !== "undefined") {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (AudioContextCtor && AudioContextCtor.prototype) {
    try {
      const origCreateMediaElementSource = AudioContextCtor.prototype.createMediaElementSource;
      AudioContextCtor.prototype.createMediaElementSource = function (element) {
        if (element instanceof HTMLMediaElement || element?.tagName === "VIDEO" || element?.tagName === "AUDIO") {
          return this.createGain();
        }
        return origCreateMediaElementSource.call(this, element);
      };
    } catch (_) {}
  }
}

// Local Profile PIN Security Engine for Web Desktop Browsers
if (typeof window !== "undefined") {
  try {
    const LOCAL_PINS_KEY = "nuvio_profile_pins";
    const LOCAL_PIN_STATES_KEY = "nuvio_profile_pin_states";

    const getLocalPins = () => {
      try {
        return JSON.parse(localStorage.getItem(LOCAL_PINS_KEY) || "{}");
      } catch (_) {
        return {};
      }
    };

    const getLocalPinStates = () => {
      try {
        return JSON.parse(localStorage.getItem(LOCAL_PIN_STATES_KEY) || "{}");
      } catch (_) {
        return {};
      }
    };

    const saveLocalPin = (profileId, pin) => {
      try {
        const idStr = String(profileId);
        const pins = getLocalPins();
        const states = getLocalPinStates();
        pins[idStr] = String(pin || "");
        states[idStr] = true;
        localStorage.setItem(LOCAL_PINS_KEY, JSON.stringify(pins));
        localStorage.setItem(LOCAL_PIN_STATES_KEY, JSON.stringify(states));
      } catch (_) {}
    };

    const removeLocalPin = (profileId) => {
      try {
        const idStr = String(profileId);
        const pins = getLocalPins();
        const states = getLocalPinStates();
        delete pins[idStr];
        states[idStr] = false;
        localStorage.setItem(LOCAL_PINS_KEY, JSON.stringify(pins));
        localStorage.setItem(LOCAL_PIN_STATES_KEY, JSON.stringify(states));
      } catch (_) {}
    };

    const verifyLocalPin = (profileId, pin) => {
      const idStr = String(profileId);
      const pins = getLocalPins();
      const stored = String(pins[idStr] || "").trim();
      const entered = String(pin || "").trim();
      return Boolean(stored.length > 0 && stored === entered);
    };

    if (ProfileSyncService) {
      if (!ProfileSyncService._origSetPin) {
        ProfileSyncService._origSetPin = ProfileSyncService.setProfilePin;
        ProfileSyncService._origClearPin = ProfileSyncService.clearProfilePin;
        ProfileSyncService._origVerifyPin = ProfileSyncService.verifyProfilePin;
        ProfileSyncService._origPullLocks = ProfileSyncService.pullProfileLockStates;
      }

      ProfileSyncService.setProfilePin = async function (profileId, pin, currentPin) {
        saveLocalPin(profileId, pin);
        try {
          if (AuthManager?.isAuthenticated) {
            await ProfileSyncService._origSetPin.call(this, profileId, pin, currentPin);
          }
        } catch (_) {}
        return true;
      };

      ProfileSyncService.clearProfilePin = async function (profileId, currentPin) {
        removeLocalPin(profileId);
        try {
          if (AuthManager?.isAuthenticated) {
            await ProfileSyncService._origClearPin.call(this, profileId, currentPin);
          }
        } catch (_) {}
        return true;
      };

      ProfileSyncService.verifyProfilePin = async function (profileId, pin) {
        const localMatch = verifyLocalPin(profileId, pin);
        if (localMatch) {
          return { unlocked: true, retryAfterSeconds: 0 };
        }
        try {
          if (AuthManager?.isAuthenticated) {
            const remoteRes = await ProfileSyncService._origVerifyPin.call(this, profileId, pin);
            if (remoteRes && remoteRes.unlocked) {
              saveLocalPin(profileId, pin);
              return remoteRes;
            }
          }
        } catch (_) {}
        return { unlocked: false, retryAfterSeconds: 0 };
      };

      ProfileSyncService.pullProfileLockStates = async function () {
        let remote = {};
        try {
          if (AuthManager?.isAuthenticated) {
            remote = (await ProfileSyncService._origPullLocks.call(this)) || {};
          }
        } catch (_) {}
        const local = getLocalPinStates();
        return { ...local, ...remote };
      };
    }

    if (ProfileSelectionScreen) {
      ProfileSelectionScreen.isProfilePinEnabled = function (profileId) {
        const idStr = String(profileId || "");
        const localStates = getLocalPinStates();
        const localPins = getLocalPins();

        const hasLocalPin = Boolean(localPins[idStr] && String(localPins[idStr]).length > 0);
        const localEnabled = Boolean(localStates[idStr]);
        const remoteEnabled = Boolean(
          this.profilePinEnabled?.[idStr] || this.profilePinEnabled?.[Number(idStr)]
        );

        return hasLocalPin || localEnabled || remoteEnabled;
      };
    }
  } catch (_) {}
}

let initialized = false;
let lastClickTime = 0;
let lastClickTarget = null;
let timelineTooltipElem = null;
let isScrubbing = false;
let playerCursorTimer = null;
let profileHoldTimer = null;
let profileHoldTargetCard = null;

function injectWebBrowserStylesheet() {
  if (typeof document === "undefined") return;
  if (document.querySelector("link[data-web-browser-css]")) return;

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "css/web-browser.css";
  link.setAttribute("data-web-browser-css", "true");
  document.head.appendChild(link);
}

function unmuteAndUnlockAudio() {
  try {
    if (typeof PlayerController !== "undefined") {
      PlayerController.setStartupAudioGate?.(false);
      PlayerController.setStartupPresentationAudioMuted?.(false);
    }
    const videoElem = document.querySelector("#videoPlayer, video");
    if (videoElem) {
      videoElem.muted = false;
      videoElem.defaultMuted = false;
      if (!Number.isFinite(Number(videoElem.volume)) || Number(videoElem.volume) <= 0) {
        videoElem.volume = 1;
      }
    }
  } catch (_) {}
}

function hasActiveModal() {
  return Boolean(
    document.body?.classList?.contains("nuvio-modal-open") ||
    document.querySelector(".nuvio-dialog-backdrop, .profile-pin-overlay")
  );
}

function getActivePlayerScreen() {
  const currentScreen = Router.getCurrentScreen();
  const route = Router.getCurrent?.() || "";
  const isPlayerRoute = route === "player" || currentScreen?.name === "player";
  const playerElem = document.querySelector("#player.screen, .player-screen");
  const isPlayerVisible = Boolean(
    playerElem &&
    playerElem.style.display !== "none" &&
    getComputedStyle(playerElem).display !== "none"
  );

  if (isPlayerRoute || isPlayerVisible) {
    return currentScreen || null;
  }
  return null;
}

function isEditableTarget(target) {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toUpperCase();
  return Boolean(
    target.isContentEditable ||
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT" ||
    target.classList.contains("settings-text-dialog-input") ||
    target.classList.contains("library-dialog-input")
  );
}

function findFocusableTarget(node) {
  if (!node || !(node instanceof Element)) return null;

  if (hasActiveModal()) {
    const modalContainer = node.closest(".nuvio-dialog-backdrop, .profile-pin-overlay, .nuvio-dialog-frame");
    if (!modalContainer) {
      return null;
    }
  }

  const focusable = node.closest(
    '.focusable, button, a, input, textarea, select, [data-action], [tabindex], ' +
    '.home-content-card, .meta-cast-card, .catalog-card, .stream-card, ' +
    '.episode-card, .player-control-btn, .player-control-button, .player-action-btn, ' +
    '.player-progress-shell, .player-header-back-btn, .player-back-btn, ' +
    '.sidebar-item, .settings-item, .profile-card, .nuvio-dialog-btn, .tab-item, [role="button"]'
  );

  if (focusable && focusable instanceof HTMLElement) {
    if (
      focusable.disabled ||
      focusable.classList.contains("is-disabled") ||
      focusable.classList.contains("disabled") ||
      focusable.getAttribute("aria-disabled") === "true"
    ) {
      return null;
    }
    return focusable;
  }
  return null;
}

function formatTimestamp(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  if (hrs > 0) {
    return `${hrs}:${pad(mins)}:${pad(secs)}`;
  }
  return `${mins}:${pad(secs)}`;
}

function updateTimelineTooltip(event, playerScreen, shell) {
  const rect = shell.getBoundingClientRect();
  const duration = Number(playerScreen.getPlaybackDurationSeconds?.() || 0);
  if (!rect || rect.width <= 0 || duration <= 0) {
    removeTimelineTooltip(playerScreen);
    return;
  }

  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  const hoverSeconds = duration * ratio;

  try {
    playerScreen.seekPreviewSeconds = hoverSeconds;
    playerScreen.renderSeekOverlay?.();
  } catch (_) {}

  if (!timelineTooltipElem) {
    timelineTooltipElem = document.createElement("div");
    timelineTooltipElem.className = "web-timeline-tooltip";
    document.body.appendChild(timelineTooltipElem);
  }

  const formattedHover = formatTimestamp(hoverSeconds);
  const formattedTotal = formatTimestamp(duration);
  timelineTooltipElem.textContent = `${formattedHover} / ${formattedTotal}`;
  timelineTooltipElem.style.left = `${Math.max(40, Math.min(window.innerWidth - 40, event.clientX))}px`;
  timelineTooltipElem.style.top = `${Math.max(10, rect.top - 36)}px`;
  timelineTooltipElem.style.opacity = "1";
}

function removeTimelineTooltip(playerScreen = null) {
  if (timelineTooltipElem) {
    timelineTooltipElem.remove();
    timelineTooltipElem = null;
  }
  if (playerScreen) {
    playerScreen.seekPreviewSeconds = null;
  }
}

function triggerFallbackActivation(target, currentScreen, event) {
  const enterEvent = new KeyboardEvent("keydown", {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true
  });

  target.dispatchEvent(enterEvent);

  const enterKeyUp = new KeyboardEvent("keyup", {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true
  });
  target.dispatchEvent(enterKeyUp);

  if (typeof currentScreen?.onKeyDown === "function") {
    const normalized = Platform.normalizeKey(enterEvent);
    normalized.target = target;
    try {
      currentScreen.onKeyDown(normalized);
    } catch (e) {
      console.warn("Screen onKeyDown fallback error:", e);
    }
  }
}

function triggerProfileOptionsDialog(profileCard) {
  if (!profileCard) return false;
  const currentScreen = Router.getCurrentScreen();
  if (currentScreen?.name === "profile-selection" || typeof currentScreen?.openOptionsDialog === "function") {
    const profileId = profileCard.dataset?.profileId || profileCard.getAttribute("data-profile-id");
    const profile = currentScreen.getProfileById?.(profileId);
    if (profile) {
      currentScreen.openOptionsDialog(profile);
      return true;
    }
  }
  return false;
}

function handlePointerDown(event) { 
  unmuteAndUnlockAudio();
  if (event.button !== 0) return;

  const profileCard = event.target?.closest?.(".profile-card[data-profile-id]");
  if (profileCard) {
    profileHoldTargetCard = profileCard;
    if (profileHoldTimer) clearTimeout(profileHoldTimer);
    profileHoldTimer = setTimeout(() => {
      if (profileHoldTargetCard) {
        triggerProfileOptionsDialog(profileHoldTargetCard);
        profileHoldTargetCard = null;
      }
    }, 450);
  }

  const playerScreen = getActivePlayerScreen();
  if (playerScreen) {
    const progressShell = event.target?.closest?.(".player-progress-shell");
    if (progressShell) {
      isScrubbing = true;
      progressShell.classList.add("is-scrubbing");
      event.preventDefault();
      event.stopPropagation();
      playerScreen.seekProgressFromPointer?.(event, progressShell);
      updateTimelineTooltip(event, playerScreen, progressShell);
    }
  }
}

function handlePointerUp(event) {
  if (profileHoldTimer) {
    clearTimeout(profileHoldTimer);
    profileHoldTimer = null;
  }
  profileHoldTargetCard = null;

  if (isScrubbing) {
    isScrubbing = false;
    const playerScreen = getActivePlayerScreen();
    const progressShell = document.querySelector(".player-progress-shell");
    if (progressShell) {
      progressShell.classList.remove("is-scrubbing");
    }
    removeTimelineTooltip(playerScreen);
  }
}

function handleContextMenu(event) {
  const profileCard = event.target?.closest?.(".profile-card[data-profile-id]");
  if (profileCard) {
    event.preventDefault();
    event.stopPropagation();
    triggerProfileOptionsDialog(profileCard);
  }
}

function handlePointerClick(event) {
  unmuteAndUnlockAudio();
  if (event.button === 2) return;

  const now = Date.now();
  const rawTarget = event.target;
  if (!(rawTarget instanceof Element)) return;

  if (hasActiveModal()) {
    const modal = rawTarget.closest(".nuvio-dialog-backdrop, .profile-pin-overlay, .nuvio-dialog-frame");
    if (!modal) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      return;
    }
  }

  const playerScreen = getActivePlayerScreen();
  if (playerScreen) {
    const progressShell = rawTarget.closest(".player-progress-shell");
    if (progressShell) {
      event.preventDefault();
      event.stopPropagation();
      playerScreen.seekProgressFromPointer?.(event, progressShell);
      removeTimelineTooltip(playerScreen);
      return;
    }

    const isControlClick = Boolean(
      rawTarget.closest(".player-control-btn, .player-control-button, .player-action-btn, .player-progress-shell, .focusable, button, [data-player-pointer-action], .player-control-bar")
    );

    if (!isControlClick && rawTarget.closest("#player, .player-screen, #videoPlayer, video, .player-video-container")) {
      event.preventDefault();
      event.stopPropagation();
      if (playerScreen.pauseOverlayVisible) {
        playerScreen.dismissPauseOverlay?.({ revealControls: true });
      }
      playerScreen.togglePause?.();
      playerScreen.setControlsVisible?.(true, { focus: false });
      playerScreen.renderControlButtons?.();
      return;
    }
  }

  const target = findFocusableTarget(rawTarget);
  const currentScreen = Router.getCurrentScreen();

  if (target && target === lastClickTarget && now - lastClickTime < 300) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  lastClickTime = now;
  lastClickTarget = target;

  if (!target) return;

  FocusEngine.focusPointerTarget(target, event);

  if (isEditableTarget(target)) {
    target.focus();
    return;
  }

  const hasNativeClick = target.tagName === "BUTTON" || target.tagName === "A" || typeof target.onclick === "function";

  if (typeof currentScreen?.onPointerActivate === "function") {
    Promise.resolve(currentScreen.onPointerActivate(target, event))
      .then((handled) => {
        if (!handled && !hasNativeClick) {
          triggerFallbackActivation(target, currentScreen, event);
        }
      })
      .catch(() => {
        if (!hasNativeClick) {
          triggerFallbackActivation(target, currentScreen, event);
        }
      });
    return;
  }

  if (!hasNativeClick) {
    triggerFallbackActivation(target, currentScreen, event);
  }
}

function handleAuxClick(event) {
  if (event.button === 2) {
    handleContextMenu(event);
    return;
  }
  if (event.button === 3 || event.button === 4) {
    event.preventDefault();
    event.stopPropagation();
    FocusEngine.handleBack(event);
  }
}

function handlePointerMove(event) {
  const playerScreen = getActivePlayerScreen();
  if (playerScreen) {
    unmuteAndUnlockAudio();

    // Show cursor and controls on mouse move
    document.documentElement.classList.remove("player-cursor-hidden");
    document.body?.classList?.remove("player-cursor-hidden");

    playerScreen.setControlsVisible?.(true, { focus: false });
    playerScreen.resetControlsAutoHide?.();

    if (playerCursorTimer) {
      clearTimeout(playerCursorTimer);
    }

    // Auto-hide cursor and controls after 2.5s of no mouse movement in player
    playerCursorTimer = setTimeout(() => {
      if (getActivePlayerScreen() && !isScrubbing) {
        document.documentElement.classList.add("player-cursor-hidden");
        document.body?.classList?.add("player-cursor-hidden");
        const activePs = getActivePlayerScreen();
        activePs?.setControlsVisible?.(false, { focus: false });
      }
    }, 2500);

    const progressShell = event.target?.closest?.(".player-progress-shell") || document.querySelector(".player-progress-shell");

    if (isScrubbing && progressShell) {
      event.preventDefault();
      event.stopPropagation();
      playerScreen.seekProgressFromPointer?.(event, progressShell);
      updateTimelineTooltip(event, playerScreen, progressShell);
      return;
    }

    const hoveredShell = event.target?.closest?.(".player-progress-shell");
    if (hoveredShell) {
      updateTimelineTooltip(event, playerScreen, hoveredShell);
    } else {
      removeTimelineTooltip(playerScreen);
    }
  } else {
    document.documentElement.classList.remove("player-cursor-hidden");
    document.body?.classList?.remove("player-cursor-hidden");
    removeTimelineTooltip();
  }
}

function handleMouseLeaveSidebar(event) {
  const currentScreen = Router.getCurrentScreen();
  const container = currentScreen?.container || document;

  setModernSidebarExpanded(container, false);
  setLegacySidebarExpanded(container, false);
  if (typeof currentScreen?.closeSidebarToContent === "function") {
    currentScreen.closeSidebarToContent();
  }
}

function handleKeyDown(event) {
  unmuteAndUnlockAudio();
  const target = event.target;
  const currentScreen = Router.getCurrentScreen();
  const playerScreen = getActivePlayerScreen();

  if (playerScreen) {
    document.documentElement.classList.remove("player-cursor-hidden");
    document.body?.classList?.remove("player-cursor-hidden");

    const key = String(event.key || "");
    const keyLower = key.toLowerCase();
    const keyCode = Number(event.keyCode || event.which || 0);

    if (key === " " || keyCode === 32) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (playerScreen.pauseOverlayVisible) {
        playerScreen.dismissPauseOverlay?.({ revealControls: true });
      }
      playerScreen.togglePause?.();
      playerScreen.setControlsVisible?.(true, { focus: false });
      playerScreen.renderControlButtons?.();
      return;
    }

    if (keyLower === "f" || keyCode === 70) {
      event.preventDefault();
      event.stopPropagation();
      if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      } else {
        document.documentElement.requestFullscreen?.().catch(() => {});
      }
      return;
    }

    // Pressing M key toggles Mute / Unmute
    if (keyLower === "m" || keyCode === 77) {
      event.preventDefault();
      event.stopPropagation();
      const videoElem = document.querySelector("#videoPlayer, video");
      if (videoElem) {
        videoElem.muted = !videoElem.muted;
        if (!videoElem.muted && videoElem.volume <= 0) {
          videoElem.volume = 1;
        }
      }
      if (typeof PlayerController !== "undefined") {
        PlayerController.setStartupAudioGate?.(false);
        PlayerController.setStartupPresentationAudioMuted?.(false);
      }
      return;
    }

    if ((key === "ArrowLeft" || key === "ArrowRight" || keyCode === 37 || keyCode === 39) && !isEditableTarget(target)) {
      const activeDropdown = document.querySelector(".player-dialog, .subtitle-dialog, .audio-dialog");
      if (!activeDropdown) {
        event.preventDefault();
        event.stopPropagation();
        const currentPos = Number(playerScreen.getCurrentPlaybackSeconds?.() || 0);
        const delta = (key === "ArrowLeft" || keyCode === 37) ? -10 : 10;
        playerScreen.seekPlaybackSeconds?.(Math.max(0, currentPos + delta));
        playerScreen.setControlsVisible?.(true, { focus: false });
        playerScreen.renderControlButtons?.();
        return;
      }
    }
  }

  const isArrowKey = event.keyCode >= 37 && event.keyCode <= 40;
  if (isArrowKey && !playerScreen) {
    const currentlyFocused = document.querySelector(".focused");
    if (!currentlyFocused) {
      const fallback = document.querySelector(".screen[style*='block'] .focusable, .focusable");
      if (fallback) {
        FocusEngine.focusPointerTarget(fallback, event);
      }
    }
  }

  if (isEditableTarget(target)) {
    const key = event.key;
    const isEditingKey =
      key === "Backspace" ||
      key === "Delete" ||
      key === "ArrowLeft" ||
      key === "ArrowRight" ||
      key === "ArrowUp" ||
      key === "ArrowDown" ||
      key === "Home" ||
      key === "End" ||
      key === " " ||
      key.length === 1;

    if (isEditingKey) {
      event.stopPropagation();
      if (key === "Enter") {
        target.blur?.();
      }
      return;
    }
  }

  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    FocusEngine.handleBack(event);
    return;
  }
}

function handleDoubleClick(event) {
  const playerScreen = getActivePlayerScreen();
  if (playerScreen) {
    event.preventDefault();
    event.stopPropagation();
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    } else {
      document.documentElement.requestFullscreen?.().catch(() => {});
    }
  }
}

function handleWheel(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const row = target.closest(
    '.home-row-cards, .catalog-cards-row, .collection-items-row, ' +
    '.meta-cast-row, [data-scroll-row], .horizontal-scroll'
  );

  if (row) {
    event.preventDefault();
    const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX;
    row.scrollLeft += delta * 1.5;
    return;
  }

  const container = target.closest(
    '.screen, .home-main, .meta-details-content, .settings-container, ' +
    '.catalog-grid, .nuvio-dialog-body, .sidebar-container'
  );

  if (container) {
    if (container.scrollHeight > container.clientHeight) {
      container.scrollTop += event.deltaY;
    }
  }
}

export function initWebInputAdapter() {
  if (initialized) return;
  initialized = true;

  if (typeof document === "undefined") return;

  document.documentElement.classList.add("platform-browser");
  document.body?.classList?.add("platform-browser");

  injectWebBrowserStylesheet();

  window.addEventListener("mousedown", handlePointerDown, true);
  window.addEventListener("mouseup", handlePointerUp, true);
  window.addEventListener("pointerdown", handlePointerDown, true);
  window.addEventListener("pointerup", handlePointerUp, true);
  window.addEventListener("click", handlePointerClick, true);
  window.addEventListener("auxclick", handleAuxClick, true);
  window.addEventListener("contextmenu", handleContextMenu, true);
  window.addEventListener("mousemove", handlePointerMove, true);
  window.addEventListener("pointermove", handlePointerMove, true);
  window.addEventListener("keydown", handleKeyDown, true);
  window.addEventListener("dblclick", handleDoubleClick, true);
  window.addEventListener("wheel", handleWheel, { passive: false, capture: true });

  document.addEventListener("mouseout", (event) => {
    if (event.target && event.relatedTarget) {
      const fromSidebar = event.target.closest?.(".home-sidebar, .modern-sidebar-shell, .modern-sidebar-panel");
      const toSidebar = event.relatedTarget.closest?.(".home-sidebar, .modern-sidebar-shell, .modern-sidebar-panel");
      if (fromSidebar && !toSidebar) {
        handleMouseLeaveSidebar(event);
      }
    }
  }, true);
}

if (typeof document !== "undefined") {
  try {
    initWebInputAdapter();
  } catch (_) {}
}
