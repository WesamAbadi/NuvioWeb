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
import {
  getSubtitleVirtualWindow,
  SUBTITLE_VIRTUALIZATION_OVERSCAN_PX,
  SUBTITLE_VIRTUALIZATION_MIN_WINDOW
} from "../../../ui/screens/player/subtitleVirtualizer.js";
import {
  PosterOptionsDialogController,
  posterItemFromNode
} from "../../../ui/components/posterOptionsMenu.js";

// Bypass WebAudio MediaElementSource capture on HTMLMediaElement in browser mode
// to prevent Chrome CORS MediaElementAudioSource zero-audio restrictions completely.
if (typeof window !== "undefined") {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (AudioContextCtor && AudioContextCtor.prototype) {
    try {
      const origCreateMediaElementSource = AudioContextCtor.prototype.createMediaElementSource;
      AudioContextCtor.prototype.createMediaElementSource = function (element) {
        if (
          element instanceof HTMLMediaElement ||
          element?.tagName === "VIDEO" ||
          element?.tagName === "AUDIO"
        ) {
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
let audioCheckInterval = null;
let lastWarnedVideoSrc = "";

function monitorAudioDecoding() {
  if (audioCheckInterval) return;

  audioCheckInterval = setInterval(() => {
    const playerScreen = getActivePlayerScreen();
    if (!playerScreen) {
      lastWarnedVideoSrc = "";
      return;
    }

    const video = document.querySelector("#videoPlayer, video");
    if (!video || video.paused || video.ended || video.muted) {
      return;
    }

    if (video.currentTime > 2.5) {
      const currentSrc = video.currentSrc || video.src || "";
      if (typeof video.webkitAudioDecodedByteCount === "number") {
        if (video.webkitAudioDecodedByteCount === 0 && lastWarnedVideoSrc !== currentSrc) {
          lastWarnedVideoSrc = currentSrc;
          console.warn(
            "[AUDIO DETECT] Unsupported audio codec! webkitAudioDecodedByteCount === 0 for stream:",
            currentSrc
          );

          if (typeof playerScreen.showAspectToast === "function") {
            playerScreen.showAspectToast("Audio: AC3 / DTS (Unsupported)", 8000);
          }
        }
      }
    }
  }, 2000);
}

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
      const savedMuted = getSavedWebMuted();
      const savedVolume = getSavedWebVolume();
      videoElem.muted = savedMuted;
      videoElem.defaultMuted = savedMuted;
      if (Number.isFinite(savedVolume) && savedVolume >= 0 && savedVolume <= 1) {
        videoElem.volume = savedVolume;
      }
    }
  } catch (_) {}
}

const WEB_VOLUME_KEY = "nuvio_web_volume";
const WEB_MUTED_KEY = "nuvio_web_muted";

function getSavedWebVolume() {
  try {
    const val = parseFloat(localStorage.getItem(WEB_VOLUME_KEY));
    return Number.isFinite(val) && val >= 0 && val <= 1 ? val : 1;
  } catch (_) {
    return 1;
  }
}

function getSavedWebMuted() {
  try {
    return localStorage.getItem(WEB_MUTED_KEY) === "true";
  } catch (_) {
    return false;
  }
}

function saveWebVolumeState(volume, muted) {
  try {
    localStorage.setItem(WEB_VOLUME_KEY, String(volume));
    localStorage.setItem(WEB_MUTED_KEY, String(Boolean(muted)));
  } catch (_) {}
}

const DESKTOP_ICONS = {
  volumeHigh:
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77zm-2.5-1.23L6.5 7H3c-.55 0-1 .45-1 1v8c0 .55.45 1 1 1h3.5l5 5c.67.67 1.5.2 1.5-.75V2.75c0-.95-.83-1.42-1.5-.75zm5 10c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>',
  volumeLow:
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M11.5 2L6.5 7H3c-.55 0-1 .45-1 1v8c0 .55.45 1 1 1h3.5l5 5c.67.67 1.5.2 1.5-.75V2.75c0-.95-.83-1.42-1.5-.75zm5 10c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>',
  volumeMute:
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>',
  pip: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M19 7h-8v6h8V7zm2-4H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14z"/></svg>',
  fullscreenEnter:
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>',
  fullscreenExit:
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>',
  chevronLeft:
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>',
  chevronRight:
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>'
};

let volumeToastTimer = null;
function showVolumeToast(text, iconType = "high") {
  if (typeof document === "undefined") return;
  let toast = document.querySelector(".web-player-volume-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "web-player-volume-toast";
    document.body.appendChild(toast);
  }

  let iconSvg = "";
  if (iconType === "mute") {
    iconSvg = DESKTOP_ICONS.volumeMute;
  } else if (iconType === "low") {
    iconSvg = DESKTOP_ICONS.volumeLow;
  } else if (iconType === "high") {
    iconSvg = DESKTOP_ICONS.volumeHigh;
  }

  toast.innerHTML = iconSvg
    ? `<span class="web-player-volume-toast-icon">${iconSvg}</span><span class="web-player-volume-toast-text">${text}</span>`
    : `<span class="web-player-volume-toast-text">${text}</span>`;

  toast.classList.add("is-visible");
  if (volumeToastTimer) clearTimeout(volumeToastTimer);
  volumeToastTimer = setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 1200);
}

function syncVolumeUi(volumeCluster = document.querySelector(".web-player-volume-cluster")) {
  if (!volumeCluster) return;
  const video = document.querySelector("#videoPlayer, video");
  const vol = video ? video.volume : getSavedWebVolume();
  const isMuted = video ? video.muted || vol === 0 : getSavedWebMuted();

  const iconContainer = volumeCluster.querySelector(".web-player-volume-icon");
  const slider = volumeCluster.querySelector(".web-player-volume-slider");

  if (iconContainer) {
    if (isMuted || vol === 0) {
      iconContainer.innerHTML = DESKTOP_ICONS.volumeMute;
    } else if (vol < 0.5) {
      iconContainer.innerHTML = DESKTOP_ICONS.volumeLow;
    } else {
      iconContainer.innerHTML = DESKTOP_ICONS.volumeHigh;
    }
  }

  if (slider && document.activeElement !== slider) {
    const currentVal = isMuted ? 0 : vol;
    slider.value = String(currentVal);
    const pct = Math.round(currentVal * 100);
    slider.style.background = `linear-gradient(to right, #ffffff 0%, #ffffff ${pct}%, rgba(255, 255, 255, 0.28) ${pct}%, rgba(255, 255, 255, 0.28) 100%)`;
  }
}

function syncFullscreenUi(desktopRight = document.querySelector(".web-player-desktop-right")) {
  if (!desktopRight) return;
  const iconSpan = desktopRight.querySelector(".web-player-fullscreen-icon");
  if (iconSpan) {
    iconSpan.innerHTML = document.fullscreenElement
      ? DESKTOP_ICONS.fullscreenExit
      : DESKTOP_ICONS.fullscreenEnter;
  }
}

function updateRowChevrons(row) {
  if (!row) return;
  const container =
    row.closest(".home-row, .catalog-row, .series-episodes-section, .meta-cast-section") ||
    row.parentElement;
  if (!container) return;
  const prevBtn = container.querySelector(".web-carousel-prev");
  const nextBtn = container.querySelector(".web-carousel-next");
  if (prevBtn) {
    prevBtn.style.display = row.scrollLeft > 10 ? "flex" : "none";
  }
  if (nextBtn) {
    const isAtEnd = row.scrollLeft + row.clientWidth >= row.scrollWidth - 10;
    nextBtn.style.display = isAtEnd ? "none" : "flex";
  }
}

function ensureRowNavigationChevrons(row) {
  if (!row || row.scrollWidth <= row.clientWidth + 20) return;
  const container =
    row.closest(".home-row, .catalog-row, .series-episodes-section, .meta-cast-section") ||
    row.parentElement;
  if (!container || container.querySelector(".web-carousel-arrow")) return;

  const prevBtn = document.createElement("button");
  prevBtn.className = "web-carousel-arrow web-carousel-prev";
  prevBtn.type = "button";
  prevBtn.setAttribute("aria-label", "Scroll left");
  prevBtn.innerHTML = DESKTOP_ICONS.chevronLeft;
  prevBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    row.scrollBy({ left: -row.clientWidth * 0.75, behavior: "smooth" });
  };

  const nextBtn = document.createElement("button");
  nextBtn.className = "web-carousel-arrow web-carousel-next";
  nextBtn.type = "button";
  nextBtn.setAttribute("aria-label", "Scroll right");
  nextBtn.innerHTML = DESKTOP_ICONS.chevronRight;
  nextBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    row.scrollBy({ left: row.clientWidth * 0.75, behavior: "smooth" });
  };

  container.appendChild(prevBtn);
  container.appendChild(nextBtn);

  row.addEventListener("scroll", () => updateRowChevrons(row), { passive: true });
  updateRowChevrons(row);
}

function bindVolumeGroupEvents(volumeCluster) {
  const btn = volumeCluster.querySelector(".web-player-volume-btn");
  const slider = volumeCluster.querySelector(".web-player-volume-slider");

  if (btn) {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const video = document.querySelector("#videoPlayer, video");
      if (!video) return;

      const isMuted = !video.muted;
      video.muted = isMuted;
      if (!isMuted && video.volume === 0) {
        video.volume = 0.5;
      }
      saveWebVolumeState(video.volume, isMuted);
      syncVolumeUi(volumeCluster);
      const percent = Math.round(video.volume * 100);
      showVolumeToast(
        isMuted ? "Muted" : `${percent}%`,
        isMuted ? "mute" : percent < 50 ? "low" : "high"
      );
    });
  }

  if (slider) {
    slider.addEventListener("focus", () => {
      volumeCluster.classList.add("is-active");
    });
    slider.addEventListener("blur", () => {
      volumeCluster.classList.remove("is-active");
    });
    slider.addEventListener("mousedown", () => {
      volumeCluster.classList.add("is-active");
    });
    window.addEventListener("mouseup", () => {
      if (document.activeElement !== slider && !volumeCluster.matches(":hover")) {
        volumeCluster.classList.remove("is-active");
      }
    });

    slider.addEventListener("input", (e) => {
      e.stopPropagation();
      const video = document.querySelector("#videoPlayer, video");
      const val = parseFloat(slider.value);
      if (video && Number.isFinite(val)) {
        video.volume = val;
        video.muted = val === 0;
        saveWebVolumeState(val, video.muted);
        syncVolumeUi(volumeCluster);
      }
    });

    slider.addEventListener("change", (e) => {
      e.stopPropagation();
      const video = document.querySelector("#videoPlayer, video");
      if (video) {
        const percent = Math.round(video.volume * 100);
        showVolumeToast(
          video.muted || video.volume === 0 ? "Muted" : `${percent}%`,
          video.muted || video.volume === 0 ? "mute" : percent < 50 ? "low" : "high"
        );
      }
    });
  }
}

function bindDesktopRightEvents(desktopRight) {
  const pipBtn = desktopRight.querySelector(".web-player-pip-btn");
  const fsBtn = desktopRight.querySelector(".web-player-fullscreen-btn");

  if (pipBtn) {
    if (!document.pictureInPictureEnabled) {
      pipBtn.style.display = "none";
    } else {
      pipBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (document.pictureInPictureElement) {
          document.exitPictureInPicture?.().catch(() => {});
        } else {
          const video = document.querySelector("#videoPlayer, video");
          if (video) video.requestPictureInPicture?.().catch(() => {});
        }
      });
    }
  }

  if (fsBtn) {
    fsBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      } else {
        document.documentElement.requestFullscreen?.().catch(() => {});
      }
    });
  }
}

function ensureDesktopPlayerControls(playerScreen = getActivePlayerScreen()) {
  if (!playerScreen) return;
  const controlsRow = document.querySelector(".player-controls-row");
  if (!controlsRow) return;

  // 1. Native-style Volume Cluster beside #playerControlButtons
  let volumeCluster = controlsRow.querySelector(".web-player-volume-cluster");
  if (!volumeCluster) {
    volumeCluster = document.createElement("div");
    volumeCluster.className = "web-player-volume-cluster";
    volumeCluster.setAttribute("data-player-pointer-action", "volume");
    volumeCluster.innerHTML = `
      <button type="button" class="player-control-btn web-player-volume-btn focusable" title="Mute/Unmute (M)" aria-label="Volume">
        <span class="player-control-icon web-player-volume-icon">${DESKTOP_ICONS.volumeHigh}</span>
      </button>
      <div class="web-player-volume-slider-wrapper">
        <input type="range" class="web-player-volume-slider focusable" min="0" max="1" step="0.02" value="1" aria-label="Volume Slider">
      </div>
    `;

    const controlButtons = controlsRow.querySelector("#playerControlButtons");
    if (controlButtons && controlButtons.nextSibling) {
      controlsRow.insertBefore(volumeCluster, controlButtons.nextSibling);
    } else {
      controlsRow.appendChild(volumeCluster);
    }

    bindVolumeGroupEvents(volumeCluster);
  }

  // 2. Desktop Right Controls (PiP + Fullscreen) matching .player-control-btn
  let desktopRight = controlsRow.querySelector(".web-player-desktop-right");
  if (!desktopRight) {
    desktopRight = document.createElement("div");
    desktopRight.className = "web-player-desktop-right";
    desktopRight.innerHTML = `
      <button type="button" class="player-control-btn web-player-pip-btn focusable" title="Picture in Picture (P)" aria-label="Picture in Picture">
        <span class="player-control-icon">${DESKTOP_ICONS.pip}</span>
      </button>
      <button type="button" class="player-control-btn web-player-fullscreen-btn focusable" title="Fullscreen (F)" aria-label="Fullscreen">
        <span class="player-control-icon web-player-fullscreen-icon">${document.fullscreenElement ? DESKTOP_ICONS.fullscreenExit : DESKTOP_ICONS.fullscreenEnter}</span>
      </button>
    `;

    controlsRow.appendChild(desktopRight);
    bindDesktopRightEvents(desktopRight);
  }

  syncVolumeUi(volumeCluster);
  syncFullscreenUi(desktopRight);
}

function patchPlayerScreenIfNeeded(playerScreen = null) {
  const ps = playerScreen || Router.routes?.player;
  if (!ps || ps._webAdapterPatched) return;
  ps._webAdapterPatched = true;

  if (!ps._origShowAspectToast) {
    ps._origShowAspectToast = ps.showAspectToast;
    ps.showAspectToast = function (label, durationMs = 1400) {
      const toast = this.uiRefs?.aspectToast;
      if (!toast) return;
      if (this.aspectToastTimer) {
        clearTimeout(this.aspectToastTimer);
        this.aspectToastTimer = null;
      }
      toast.textContent = String(label || "");
      toast.classList.remove("hidden");
      this.aspectToastTimer = setTimeout(() => {
        toast.classList.add("hidden");
      }, durationMs);
    };
  }

  if (!ps._origRenderControlButtons) {
    ps._origRenderControlButtons = ps.renderControlButtons;
    ps.renderControlButtons = function (...args) {
      const res = ps._origRenderControlButtons.apply(this, args);
      try {
        ensureDesktopPlayerControls(this);
      } catch (_) {}
      return res;
    };
  }
}

function hasActiveModal() {
  return Boolean(
    document.body?.classList?.contains("nuvio-modal-open") ||
    document.querySelector(
      ".nuvio-dialog-backdrop, .profile-pin-overlay, .player-post-play-synopsis-overlay, [data-player-post-play-modal]"
    )
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
    const ps = currentScreen || Router.routes?.player || null;
    patchPlayerScreenIfNeeded(ps);
    return ps;
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
    const modalContainer = node.closest(
      ".nuvio-dialog-backdrop, .profile-pin-overlay, .nuvio-dialog-frame, " +
        ".player-post-play-synopsis-overlay, [data-player-post-play-modal], .player-post-play-manual-dialog"
    );
    if (!modalContainer) {
      return null;
    }
  }

  const focusable = node.closest(
    ".focusable, button, a, input, textarea, select, [data-action], [data-action-id], [data-mode], [data-layout], [tabindex], " +
      ".home-content-card, .meta-cast-card, .catalog-card, .stream-card, " +
      ".episode-card, .series-episode-card, .tmdb-entity-card, .experience-mode-card, .catalog-order-focusable, .addons-focusable, .license-row, " +
      ".series-primary-btn, .series-secondary-btn, .series-circle-btn, .series-season-btn, .series-insight-tab, " +
      ".detail-morelike-card, .series-stream-card, .series-stream-filter, .series-stream-overlay-backdrop, " +
      ".player-control-btn, .player-control-button, .player-action-btn, " +
      ".player-progress-shell, .player-header-back-btn, .player-back-btn, " +
      ".player-dialog-item, .player-sources-item, [data-sources-zone], [data-subtitle-rail], " +
      "[data-audio-column], [data-speed-index], [data-episode-stream-index], " +
      "[data-player-post-play-action], .player-post-play-action, .player-post-play-synopsis, [data-player-post-play-modal], " +
      ".web-player-volume-btn, .web-player-volume-cluster, .web-player-volume-slider, .web-player-pip-btn, .web-player-fullscreen-btn, .web-player-desktop-right, " +
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
  if (!target) return;
  FocusEngine.focusPointerTarget(target, event);

  const enterEvent = new KeyboardEvent("keydown", {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true
  });

  target.dispatchEvent(enterEvent);

  if (typeof currentScreen?.onKeyDown === "function") {
    const normalized = Platform.normalizeKey(enterEvent);
    normalized.target = target;
    try {
      currentScreen.onKeyDown(normalized);
    } catch (e) {
      console.warn("Screen onKeyDown fallback error:", e);
    }
  }

  const enterKeyUp = new KeyboardEvent("keyup", {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true
  });
  target.dispatchEvent(enterKeyUp);

  if (typeof currentScreen?.onKeyUp === "function") {
    const normalizedUp = Platform.normalizeKey(enterKeyUp);
    normalizedUp.target = target;
    try {
      currentScreen.onKeyUp(normalizedUp);
    } catch (e) {
      console.warn("Screen onKeyUp fallback error:", e);
    }
  }
}

function triggerProfileOptionsDialog(profileCard) {
  if (!profileCard) return false;
  const currentScreen = Router.getCurrentScreen();
  if (
    currentScreen?.name === "profile-selection" ||
    typeof currentScreen?.openOptionsDialog === "function"
  ) {
    const profileId = profileCard.dataset?.profileId || profileCard.getAttribute("data-profile-id");
    const profile = currentScreen.getProfileById?.(profileId);
    if (profile) {
      currentScreen.openOptionsDialog(profile);
      return true;
    }
  }
  return false;
}

let adapterPosterOptionsController = null;

async function triggerPosterOptionsMenu(card) {
  if (!card) return false;
  const currentScreen = Router.getCurrentScreen();
  if (typeof currentScreen?.openPosterOptionsMenu === "function") {
    return currentScreen.openPosterOptionsMenu(card);
  }

  const item = posterItemFromNode(card, card.dataset?.itemType || "movie");
  if (!item?.id) return false;

  if (!adapterPosterOptionsController) {
    adapterPosterOptionsController = new PosterOptionsDialogController({
      onDetails: (target) => {
        Router.navigate("detail", {
          itemId: target.id,
          itemType: target.type || "movie",
          fallbackTitle: target.title || "Untitled",
          fallbackPoster: target.poster || "",
          fallbackBackground: target.background || "",
          addonBaseUrl: target.addonBaseUrl || "",
          addonId: target.addonId || "",
          addonName: target.addonName || "",
          catalogType: target.catalogType || target.type || "movie"
        });
      },
      onDismiss: () => {
        FocusEngine.focusPointerTarget(card);
      },
      onChanged: () => {
        currentScreen?.render?.();
      }
    });
  }

  return adapterPosterOptionsController.open(item, {
    focusKey: card.dataset?.focusKey || "",
    itemIndex: -1
  });
}

const HORIZONTAL_ROW_SELECTOR =
  ".home-row-cards, .catalog-cards-row, .collection-items-row, " +
  ".meta-cast-row, .series-episode-track, .series-insight-tabs, [data-scroll-row], .horizontal-scroll";

let activeDragRow = null;
let dragStartX = 0;
let dragStartScrollLeft = 0;
let hasDragged = false;

function handlePointerDown(event) {
  unmuteAndUnlockAudio();
  if (event.button !== 0) return;

  const row = event.target?.closest?.(HORIZONTAL_ROW_SELECTOR);
  if (row && row.scrollWidth > row.clientWidth) {
    activeDragRow = row;
    dragStartX = event.clientX;
    dragStartScrollLeft = row.scrollLeft;
    hasDragged = false;
  }

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

  if (activeDragRow) {
    document.body.classList.remove("is-dragging-row");
    activeDragRow.classList.remove("is-dragging");
    if (hasDragged) {
      setTimeout(() => {
        hasDragged = false;
      }, 60);
    }
    activeDragRow = null;
  }

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

async function handleContextMenu(event) {
  const profileCard = event.target?.closest?.(".profile-card[data-profile-id]");
  if (profileCard) {
    event.preventDefault();
    event.stopPropagation();
    triggerProfileOptionsDialog(profileCard);
    return;
  }

  const card = event.target?.closest?.(
    ".home-content-card, .catalog-card, .meta-cast-card, .detail-morelike-card, .stream-card, .series-episode-card"
  );
  if (card) {
    event.preventDefault();
    event.stopPropagation();
    await triggerPosterOptionsMenu(card);
    return;
  }
}

function handleDetailPointerClick(target, event, currentScreen) {
  if (!target || !currentScreen) return false;
  const actionTarget = target.closest("[data-action]") || target;
  const action = String(actionTarget.dataset?.action || "");

  // 1. Play Default (Movie or Series hero play button)
  if (action === "playDefault") {
    event.preventDefault();
    event.stopPropagation();
    void currentScreen.playDefaultFromHero?.();
    return true;
  }

  // 2. Play from Beginning
  if (action === "playFromBeginning") {
    event.preventDefault();
    event.stopPropagation();
    void currentScreen.playDefaultFromHero?.({ startOver: true });
    return true;
  }

  // 3. Toggle Library
  if (action === "toggleLibrary") {
    event.preventDefault();
    event.stopPropagation();
    void currentScreen.toggleLibraryFromHero?.();
    return true;
  }

  // 4. Toggle Watched
  if (action === "toggleWatched") {
    event.preventDefault();
    event.stopPropagation();
    void currentScreen.toggleWatchedFromHero?.();
    return true;
  }

  // 5. Toggle Trailer
  if (action === "toggleTrailer") {
    event.preventDefault();
    event.stopPropagation();
    currentScreen.playTrailer?.({ muted: false, restart: true, initiatedByUser: true });
    return true;
  }

  // 6. Season Selection Button
  if (action === "selectSeason" || target.closest(".series-season-btn")) {
    const seasonBtn = target.closest(".series-season-btn") || actionTarget;
    const season = Number(seasonBtn.dataset?.season ?? currentScreen.selectedSeason ?? 0);
    if (season >= 0 && season !== currentScreen.selectedSeason) {
      event.preventDefault();
      event.stopPropagation();
      currentScreen.hasManualSeasonSelection = true;
      currentScreen.selectedSeason = season;
      currentScreen.render?.(currentScreen.meta, {
        selector: `.series-season-btn[data-season="${season}"]`
      });
      return true;
    }
  }

  // 7. Episode Card in Season Carousel
  if (action === "openEpisodeStreams" || target.closest(".series-episode-card")) {
    const episodeCard = target.closest(".series-episode-card") || actionTarget;
    const videoId = episodeCard.dataset?.videoId;
    if (videoId) {
      event.preventDefault();
      event.stopPropagation();
      void currentScreen.openEpisodeStreamChooser?.(videoId);
      return true;
    }
  }

  // 8. Stream Selection from Chooser (Episode or Movie)
  if (
    action === "playEpisodeStream" ||
    target.closest(".series-stream-card[data-action='playEpisodeStream']")
  ) {
    const streamCard = target.closest(".series-stream-card") || actionTarget;
    const streamId = streamCard.dataset?.streamId;
    if (streamId) {
      event.preventDefault();
      event.stopPropagation();
      currentScreen.playEpisodeFromSelectedStream?.(streamId);
      return true;
    }
  }

  if (
    action === "playPendingStream" ||
    target.closest(".series-stream-card[data-action='playPendingStream']")
  ) {
    const streamCard = target.closest(".series-stream-card") || actionTarget;
    const streamId = streamCard.dataset?.streamId;
    if (streamId) {
      event.preventDefault();
      event.stopPropagation();
      currentScreen.playMovieFromSelectedStream?.(streamId);
      return true;
    }
  }

  // 9. Stream Filter Buttons (Addons)
  if (action === "setStreamFilter" || target.closest(".series-stream-filter")) {
    const filterBtn = target.closest(".series-stream-filter") || actionTarget;
    const addon = filterBtn.dataset?.addon || "all";
    event.preventDefault();
    event.stopPropagation();
    if (currentScreen.pendingEpisodeSelection) {
      currentScreen.pendingEpisodeSelection.addonFilter = addon;
      currentScreen.renderEpisodeStreamChooser?.();
      return true;
    }
    if (currentScreen.pendingMovieSelection) {
      currentScreen.pendingMovieSelection.addonFilter = addon;
      currentScreen.renderMovieStreamChooser?.();
      return true;
    }
    return true;
  }

  // 10. Dismiss Stream Chooser Backdrop
  if (target.matches(".series-stream-overlay-backdrop, .series-stream-overlay")) {
    event.preventDefault();
    event.stopPropagation();
    if (currentScreen.pendingEpisodeSelection) {
      currentScreen.pendingEpisodeSelection = null;
      currentScreen.renderEpisodeStreamChooser?.();
      return true;
    }
    if (currentScreen.pendingMovieSelection) {
      currentScreen.pendingMovieSelection = null;
      currentScreen.renderMovieStreamChooser?.();
      return true;
    }
  }

  // 11. Insight Tabs (Cast, Ratings, More Like This, Trailer, Collection)
  if (
    action === "setSeriesInsightTab" ||
    action === "setMovieInsightTab" ||
    target.closest(".series-insight-tab")
  ) {
    const tabBtn = target.closest(".series-insight-tab") || actionTarget;
    const tab = String(tabBtn.dataset?.tab || "");
    if (tab) {
      event.preventDefault();
      event.stopPropagation();
      const isSeries =
        typeof currentScreen.episodes !== "undefined" && Array.isArray(currentScreen.episodes);
      if (isSeries) {
        currentScreen.seriesInsightTab = tab;
      } else {
        currentScreen.movieInsightTab = tab;
      }
      currentScreen.updateRenderedDetailSections?.(currentScreen.meta);
      return true;
    }
  }

  // 12. More Like This Poster Cards
  if (target.closest(".detail-morelike-card")) {
    const morelikeCard = target.closest(".detail-morelike-card");
    if (typeof currentScreen.openTmdbEntityFromNode === "function") {
      event.preventDefault();
      event.stopPropagation();
      return Boolean(currentScreen.openTmdbEntityFromNode(morelikeCard));
    }
  }

  return false;
}

function handlePointerClick(event) {
  unmuteAndUnlockAudio();
  if (event.button === 2) return;

  if (hasDragged) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    return;
  }

  const now = Date.now();
  const rawTarget = event.target;
  if (!(rawTarget instanceof Element)) return;

  if (hasActiveModal()) {
    const modal = rawTarget.closest(
      ".nuvio-dialog-backdrop, .profile-pin-overlay, .nuvio-dialog-frame"
    );
    if (!modal) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      return;
    }
  }

  const playerScreen = getActivePlayerScreen();
  if (playerScreen) {
    if (playerScreen.isPostPlayVisible?.()) {
      const postPlayAction = rawTarget.closest(
        "[data-player-post-play-action], [data-player-post-play-modal]"
      );
      if (postPlayAction) {
        event.preventDefault();
        event.stopPropagation();
        if (typeof playerScreen.handlePostPlayPointer === "function") {
          playerScreen.handlePostPlayPointer(postPlayAction, event);
        }
        return;
      }
      if (
        rawTarget.closest(
          ".player-post-play-root, .player-post-play-content, .player-post-play-backdrop, " +
            ".player-post-play-scrim, .player-post-play-synopsis-overlay, .player-post-play-manual-dialog"
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }

    const progressShell = rawTarget.closest(".player-progress-shell");
    if (progressShell) {
      event.preventDefault();
      event.stopPropagation();
      playerScreen.seekProgressFromPointer?.(event, progressShell);
      removeTimelineTooltip(playerScreen);
      return;
    }

    const isControlClick = Boolean(
      rawTarget.closest(
        ".player-control-btn, .player-control-button, .player-action-btn, .player-progress-shell, " +
          ".player-dialog, .player-subtitle-dialog, .player-audio-dialog, .player-sources-panel, .player-sources-drawer, " +
          ".player-episode-panel, .player-dialog-item, .player-sources-item, [data-sources-zone], [data-subtitle-rail], " +
          "[data-audio-column], [data-speed-index], [data-episode-action], [data-episode-stream-index], " +
          "[data-player-post-play-action], .player-post-play-action, .player-post-play-synopsis, [data-player-post-play-modal], " +
          ".web-player-volume-group, .web-player-btn, .web-player-volume-slider, .web-player-desktop-right, .web-player-volume-toast, " +
          ".focusable, button, [data-player-pointer-action], .player-control-bar"
      )
    );

    if (
      !isControlClick &&
      rawTarget.closest("#player, .player-screen, #videoPlayer, video, .player-video-container")
    ) {
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

  // 1. Direct handle for Detail screen actions (Play, Episodes, Seasons, Library, Streams)
  const isDetailScreen =
    Router.getCurrent?.() === "detail" ||
    currentScreen?.name === "detail" ||
    Boolean(target.closest(".series-detail-screen, .series-detail-content, .detail-hero-section"));
  if (isDetailScreen && handleDetailPointerClick(target, event, currentScreen)) {
    return;
  }

  // 2. Allow onPointerActivate if provided by the screen
  if (typeof currentScreen?.onPointerActivate === "function") {
    Promise.resolve(currentScreen.onPointerActivate(target, event))
      .then((handled) => {
        if (!handled) {
          triggerFallbackActivation(target, currentScreen, event);
        }
      })
      .catch(() => {
        triggerFallbackActivation(target, currentScreen, event);
      });
    return;
  }

  // 3. Fallback activation (Enter keydown + keyup on focused node)
  triggerFallbackActivation(target, currentScreen, event);
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
  if (activeDragRow && event.buttons & 1) {
    const dx = event.clientX - dragStartX;
    if (!hasDragged && Math.abs(dx) > 6) {
      hasDragged = true;
      document.body.classList.add("is-dragging-row");
      activeDragRow.classList.add("is-dragging");
    }
    if (hasDragged) {
      event.preventDefault();
      activeDragRow.scrollLeft = dragStartScrollLeft - dx;
      updateRowChevrons(activeDragRow);
      return;
    }
  }

  const hoveredRow = event.target?.closest?.(HORIZONTAL_ROW_SELECTOR);
  if (hoveredRow) {
    ensureRowNavigationChevrons(hoveredRow);
  }

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

    const progressShell =
      event.target?.closest?.(".player-progress-shell") ||
      document.querySelector(".player-progress-shell");

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

  if (playerScreen && !isEditableTarget(target)) {
    document.documentElement.classList.remove("player-cursor-hidden");
    document.body?.classList?.remove("player-cursor-hidden");

    const key = String(event.key || "");
    const keyLower = key.toLowerCase();
    const keyCode = Number(event.keyCode || event.which || 0);

    // Play / Pause: Space or K
    if (key === " " || keyCode === 32 || keyLower === "k" || keyCode === 75) {
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

    // Fullscreen: F
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

    // Mute / Unmute: M
    if (keyLower === "m" || keyCode === 77) {
      event.preventDefault();
      event.stopPropagation();
      const videoElem = document.querySelector("#videoPlayer, video");
      if (videoElem) {
        const isMuted = !videoElem.muted;
        videoElem.muted = isMuted;
        if (!isMuted && videoElem.volume <= 0) {
          videoElem.volume = 0.5;
        }
        saveWebVolumeState(videoElem.volume, isMuted);
        syncVolumeUi();
        const percent = Math.round(videoElem.volume * 100);
        showVolumeToast(
          isMuted ? "Muted" : `${percent}%`,
          isMuted ? "mute" : percent < 50 ? "low" : "high"
        );
      }
      return;
    }

    // Picture-in-Picture: P
    if (keyLower === "p" || keyCode === 80) {
      if (document.pictureInPictureEnabled) {
        event.preventDefault();
        event.stopPropagation();
        if (document.pictureInPictureElement) {
          document.exitPictureInPicture?.().catch(() => {});
        } else {
          const videoElem = document.querySelector("#videoPlayer, video");
          if (videoElem) videoElem.requestPictureInPicture?.().catch(() => {});
        }
        return;
      }
    }

    // Seek -10s: J
    if (keyLower === "j" || keyCode === 74) {
      event.preventDefault();
      event.stopPropagation();
      const currentPos = Number(playerScreen.getCurrentPlaybackSeconds?.() || 0);
      playerScreen.seekPlaybackSeconds?.(Math.max(0, currentPos - 10));
      playerScreen.setControlsVisible?.(true, { focus: false });
      playerScreen.renderControlButtons?.();
      return;
    }

    // Seek +10s: L
    if (keyLower === "l" || keyCode === 76) {
      event.preventDefault();
      event.stopPropagation();
      const currentPos = Number(playerScreen.getCurrentPlaybackSeconds?.() || 0);
      const duration = Number(playerScreen.getPlaybackDurationSeconds?.() || 0);
      playerScreen.seekPlaybackSeconds?.(
        duration > 0 ? Math.min(duration, currentPos + 10) : currentPos + 10
      );
      playerScreen.setControlsVisible?.(true, { focus: false });
      playerScreen.renderControlButtons?.();
      return;
    }

    // Left / Right Arrow: Seek 5s (when not in a dialog)
    if (
      (key === "ArrowLeft" || key === "ArrowRight" || keyCode === 37 || keyCode === 39) &&
      !isEditableTarget(target)
    ) {
      const activeDropdown = document.querySelector(
        ".player-dialog, .subtitle-dialog, .audio-dialog, .player-sources-panel, .player-episode-panel"
      );
      if (!activeDropdown) {
        event.preventDefault();
        event.stopPropagation();
        const currentPos = Number(playerScreen.getCurrentPlaybackSeconds?.() || 0);
        const duration = Number(playerScreen.getPlaybackDurationSeconds?.() || 0);
        const delta = key === "ArrowLeft" || keyCode === 37 ? -5 : 5;
        const targetPos = Math.max(
          0,
          duration > 0 ? Math.min(duration, currentPos + delta) : currentPos + delta
        );
        playerScreen.seekPlaybackSeconds?.(targetPos);
        playerScreen.setControlsVisible?.(true, { focus: false });
        playerScreen.renderControlButtons?.();
        return;
      }
    }

    // Up / Down Arrow: Volume +/- 5% (when not in a dialog)
    if (
      (key === "ArrowUp" || key === "ArrowDown" || keyCode === 38 || keyCode === 40) &&
      !isEditableTarget(target)
    ) {
      const activeDropdown = document.querySelector(
        ".player-dialog, .subtitle-dialog, .audio-dialog, .player-sources-panel, .player-episode-panel"
      );
      if (!activeDropdown) {
        event.preventDefault();
        event.stopPropagation();
        const video = document.querySelector("#videoPlayer, video");
        if (video) {
          const delta = key === "ArrowUp" || keyCode === 38 ? 0.05 : -0.05;
          const newVol = Math.max(0, Math.min(1, Math.round((video.volume + delta) * 100) / 100));
          video.volume = newVol;
          video.muted = newVol === 0;
          saveWebVolumeState(newVol, video.muted);
          syncVolumeUi();
          const percent = Math.round(newVol * 100);
          showVolumeToast(
            newVol === 0 ? "Muted" : `${percent}%`,
            newVol === 0 ? "mute" : percent < 50 ? "low" : "high"
          );
        }
        return;
      }
    }

    // Quick Subtitle Toggle: C
    if (keyLower === "c" || keyCode === 67) {
      event.preventDefault();
      event.stopPropagation();
      if (typeof playerScreen.toggleSubtitles === "function") {
        playerScreen.toggleSubtitles();
      } else if (typeof playerScreen.selectSubtitleTrack === "function") {
        const isSubOn =
          (Number.isFinite(playerScreen.selectedSubtitleTrackIndex) &&
            playerScreen.selectedSubtitleTrackIndex >= 0) ||
          Boolean(playerScreen.selectedManifestSubtitleTrackId);
        if (isSubOn) {
          playerScreen._lastSubtitleTrack = playerScreen.selectedSubtitleTrackIndex;
          playerScreen.selectSubtitleTrack(-1);
          showVolumeToast("Subtitles: Off");
        } else {
          const restore =
            typeof playerScreen._lastSubtitleTrack === "number" &&
            playerScreen._lastSubtitleTrack >= 0
              ? playerScreen._lastSubtitleTrack
              : 0;
          playerScreen.selectSubtitleTrack(restore);
          showVolumeToast("Subtitles: On");
        }
      }
      return;
    }

    // Number keys 0-9: Seek to percentage (0 = 0%, 5 = 50%, etc.)
    if (/^[0-9]$/.test(key) && !event.ctrlKey && !event.altKey && !event.metaKey) {
      const duration = Number(playerScreen.getPlaybackDurationSeconds?.() || 0);
      if (duration > 0) {
        event.preventDefault();
        event.stopPropagation();
        const pct = Number(key) * 0.1;
        playerScreen.seekPlaybackSeconds?.(duration * pct);
        playerScreen.setControlsVisible?.(true, { focus: false });
        playerScreen.renderControlButtons?.();
        showVolumeToast(`Seek: ${Math.round(pct * 100)}%`);
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
    const keyCode = Number(event.keyCode || event.which || 0);

    if (key === "Enter" || keyCode === 13) {
      event.preventDefault();
      event.stopPropagation();
      const currentScreen = Router.getCurrentScreen();
      if (typeof currentScreen?.runSearchFromInput === "function") {
        void currentScreen.runSearchFromInput(target, { autoFocusResults: true });
      }
      target.blur?.();
      return;
    }

    if (key === "Escape" || keyCode === 27) {
      event.preventDefault();
      event.stopPropagation();
      if (target.id === "searchInput") {
        target.value = "";
        const currentScreen = Router.getCurrentScreen();
        if (typeof currentScreen?.runSearchFromInput === "function") {
          void currentScreen.runSearchFromInput(target, { autoFocusResults: false });
        }
      }
      target.blur?.();
      return;
    }

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
      key.length === 1 ||
      event.ctrlKey ||
      event.metaKey;

    if (isEditingKey) {
      event.stopPropagation();
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

  // 1. Horizontal card carousels
  const row = target.closest(
    ".home-row-cards, .catalog-cards-row, .collection-items-row, " +
      ".meta-cast-row, [data-scroll-row], .horizontal-scroll"
  );
  if (row) {
    event.preventDefault();
    const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX;
    row.scrollLeft += delta * 1.5;
    return;
  }

  // 2. Stream route virtualized list
  const streamList = target.closest(".stream-route-list");
  if (streamList) {
    event.preventDefault();
    const currentScreen = Router.getCurrentScreen();
    if (typeof currentScreen?.setListScrollTop === "function") {
      const deltaMode = Number(event.deltaMode || 0);
      const multiplier = deltaMode === 1 ? 40 : deltaMode === 2 ? streamList.clientHeight : 1;
      const deltaY = Number(event.deltaY || 0) * multiplier;
      currentScreen.setListScrollTop(
        streamList,
        currentScreen.getListScrollTop(streamList) + deltaY
      );
      currentScreen.requestStreamVirtualSync?.();
      currentScreen.requestStreamBadgeHydration?.();
    } else {
      streamList.scrollTop += event.deltaY;
    }
    return;
  }

  // 3. Subtitle options rail (virtualized or native)
  const subtitleRail = target.closest(".player-subtitle-options-rail, .player-subtitle-rail");
  if (subtitleRail) {
    event.preventDefault();
    const playerScreen = getActivePlayerScreen();
    if (typeof playerScreen?.scrollSubtitleOptionsRail === "function") {
      playerScreen.scrollSubtitleOptionsRail(event.deltaY);
    } else {
      subtitleRail.scrollTop += event.deltaY;
    }
    return;
  }

  // 4. Specific scrollable panels and containers
  const scrollable = target.closest(
    ".home-main, .meta-details-content, .settings-container, .catalog-grid, " +
      ".catalog-order-main, .licenses-list, .experience-mode-screen, .player-sources-list, " +
      ".player-sources-drawer, .player-dialog, .player-audio-dialog, .player-subtitle-dialog, " +
      ".nuvio-dialog-body, .sidebar-container, [data-scroll-container]"
  );
  if (scrollable && scrollable.scrollHeight > scrollable.clientHeight) {
    scrollable.scrollTop += event.deltaY;
    return;
  }

  // 6. General scrollable element fallback (excluding fixed screen containers)
  let el = target instanceof HTMLElement ? target : target.parentElement;
  while (
    el &&
    el !== document.body &&
    el !== document.documentElement &&
    !el.classList.contains("screen")
  ) {
    if (
      el.scrollHeight > el.clientHeight &&
      getComputedStyle(el).overflowY.match(/(auto|scroll)/)
    ) {
      el.scrollTop += event.deltaY;
      return;
    }
    el = el.parentElement;
  }
}

function ensureSearchInputClearButton() {
  const input = document.querySelector("#searchInput");
  if (!input) return;
  const parent = input.parentElement;
  if (!parent || parent.querySelector(".web-search-clear-btn")) return;

  parent.style.position = "relative";
  const clearBtn = document.createElement("button");
  clearBtn.className = "web-search-clear-btn";
  clearBtn.type = "button";
  clearBtn.setAttribute("aria-label", "Clear search");
  clearBtn.innerHTML = "&times;";
  clearBtn.style.display = input.value?.length > 0 ? "flex" : "none";

  clearBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    input.value = "";
    clearBtn.style.display = "none";
    input.focus();
    const currentScreen = Router.getCurrentScreen();
    currentScreen?.runSearchFromInput?.(input, { autoFocusResults: false });
  };

  input.addEventListener("input", () => {
    clearBtn.style.display = input.value?.length > 0 ? "flex" : "none";
  });

  parent.appendChild(clearBtn);
}

function syncHashWithRoute(routeName, params = {}) {
  if (!routeName || typeof window === "undefined") return;
  const searchParams = new URLSearchParams();
  if (params && typeof params === "object") {
    for (const [key, value] of Object.entries(params)) {
      if (value != null && typeof value !== "object" && typeof value !== "function") {
        searchParams.set(key, String(value));
      }
    }
  }
  const queryStr = searchParams.toString();
  const newHash = queryStr ? `#/${routeName}?${queryStr}` : `#/${routeName}`;
  if (window.location.hash !== newHash) {
    window.history.replaceState({ route: routeName, params }, "", newHash);
  }
}

function parseHashRoute() {
  if (typeof window === "undefined" || !window.location.hash) return null;
  const hash = window.location.hash.replace(/^#\/?/, "");
  if (!hash) return null;
  const [routePart, queryPart] = hash.split("?");
  const routeName = routePart?.trim();
  if (!routeName || !Router.routes?.[routeName]) return null;
  const params = {};
  if (queryPart) {
    const searchParams = new URLSearchParams(queryPart);
    for (const [key, val] of searchParams.entries()) {
      params[key] = val;
    }
  }
  return { routeName, params };
}

function patchRouterForWebHistory() {
  if (typeof Router === "undefined" || Router._webHistoryPatched) return;
  Router._webHistoryPatched = true;

  const origNavigate = Router.navigate;
  Router.navigate = async function (routeName, params = {}, options = {}) {
    const res = await origNavigate.call(this, routeName, params, options);
    try {
      syncHashWithRoute(routeName, params);
    } catch (_) {}
    return res;
  };

  window.addEventListener("popstate", () => {
    const target = parseHashRoute();
    if (target && target.routeName !== Router.getCurrent()) {
      Router.navigate(target.routeName, target.params, { skipStackPush: true });
    }
  });

  // Check if direct link was requested on load
  const initial = parseHashRoute();
  if (initial && initial.routeName !== "home") {
    const checkReady = () => {
      if (Router.getCurrent()) {
        Router.navigate(initial.routeName, initial.params, { skipStackPush: true });
      } else {
        setTimeout(checkReady, 150);
      }
    };
    setTimeout(checkReady, 350);
  }
}

export function initWebInputAdapter() {
  if (initialized) return;
  initialized = true;

  if (typeof document === "undefined") return;

  document.documentElement.classList.add("platform-browser");
  document.body?.classList?.add("platform-browser");

  injectWebBrowserStylesheet();

  monitorAudioDecoding();

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

  document.addEventListener("fullscreenchange", () => {
    syncFullscreenUi();
  });

  patchRouterForWebHistory();

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

  document.addEventListener(
    "mouseout",
    (event) => {
      if (event.target && event.relatedTarget) {
        const fromSidebar = event.target.closest?.(
          ".home-sidebar, .modern-sidebar-shell, .modern-sidebar-panel"
        );
        const toSidebar = event.relatedTarget.closest?.(
          ".home-sidebar, .modern-sidebar-shell, .modern-sidebar-panel"
        );
        if (fromSidebar && !toSidebar) {
          handleMouseLeaveSidebar(event);
        }
      }
    },
    true
  );
}

if (typeof document !== "undefined") {
  try {
    initWebInputAdapter();
  } catch (_) {}
}
