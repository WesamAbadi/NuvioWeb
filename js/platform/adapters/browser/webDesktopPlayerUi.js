import { Router } from "../../../ui/navigation/router.js";
import { PlayerController } from "../../../core/player/playerController.js";

export const DESKTOP_ICONS = {
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
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>'
};

const WEB_VOLUME_KEY = "nuvio_web_volume";
const WEB_MUTED_KEY = "nuvio_web_muted";

let volumeToastTimer = null;
let timelineTooltipElem = null;
let isScrubbing = false;
let playerCursorTimer = null;

export function getSavedWebVolume() {
  try {
    const val = parseFloat(localStorage.getItem(WEB_VOLUME_KEY));
    return Number.isFinite(val) && val >= 0 && val <= 1 ? val : 1;
  } catch (_) {
    return 1;
  }
}

export function getSavedWebMuted() {
  try {
    return localStorage.getItem(WEB_MUTED_KEY) === "true";
  } catch (_) {
    return false;
  }
}

export function saveWebVolumeState(volume, muted) {
  try {
    localStorage.setItem(WEB_VOLUME_KEY, String(volume));
    localStorage.setItem(WEB_MUTED_KEY, String(Boolean(muted)));
  } catch (_) {}
}

export function unmuteAndUnlockAudio() {
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

export function showVolumeToast(text, iconType = "high") {
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

export function syncVolumeUi(volumeCluster = document.querySelector(".web-player-volume-cluster")) {
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

export function syncFullscreenUi(
  desktopRight = document.querySelector(".web-player-desktop-right")
) {
  if (!desktopRight) return;
  const iconSpan = desktopRight.querySelector(".web-player-fullscreen-icon");
  if (iconSpan) {
    iconSpan.innerHTML = document.fullscreenElement
      ? DESKTOP_ICONS.fullscreenExit
      : DESKTOP_ICONS.fullscreenEnter;
  }
}

export function bindVolumeGroupEvents(volumeCluster) {
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

export function bindDesktopRightEvents(desktopRight) {
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

export function ensureDesktopPlayerControls(playerScreen = getActivePlayerScreen()) {
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

export function patchPlayerScreenIfNeeded(playerScreen = null) {
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

export function getActivePlayerScreen() {
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

export function formatTimestamp(totalSeconds) {
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

export function updateTimelineTooltip(event, playerScreen, shell) {
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

export function removeTimelineTooltip(playerScreen = null) {
  if (timelineTooltipElem) {
    timelineTooltipElem.remove();
    timelineTooltipElem = null;
  }
  if (playerScreen) {
    playerScreen.seekPreviewSeconds = null;
  }
}

export function getIsScrubbing() {
  return isScrubbing;
}

export function setIsScrubbing(val) {
  isScrubbing = Boolean(val);
}

export function showPlayerCursor() {
  document.documentElement.classList.remove("player-cursor-hidden");
  document.body?.classList?.remove("player-cursor-hidden");
}

export function hidePlayerCursor() {
  document.documentElement.classList.add("player-cursor-hidden");
  document.body?.classList?.add("player-cursor-hidden");
}

export function resetPlayerCursorTimer(playerScreen) {
  showPlayerCursor();

  playerScreen.setControlsVisible?.(true, { focus: false });
  playerScreen.resetControlsAutoHide?.();

  if (playerCursorTimer) {
    clearTimeout(playerCursorTimer);
  }

  playerCursorTimer = setTimeout(() => {
    if (getActivePlayerScreen() && !isScrubbing) {
      hidePlayerCursor();
      const activePs = getActivePlayerScreen();
      activePs?.setControlsVisible?.(false, { focus: false });
    }
  }, 2500);
}
