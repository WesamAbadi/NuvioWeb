import { Router } from "../../../ui/navigation/router.js";
import { PlayerController } from "../../../core/player/playerController.js";

export const DESKTOP_ICONS = {
  volumeHigh:
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12.5 4.3c0-.86-.98-1.34-1.66-.78L6.8 7.5H3.5C2.67 7.5 2 8.17 2 9v6c0 .83.67 1.5 1.5 1.5h3.3l4.04 3.98c.68.56 1.66.08 1.66-.78V4.3z" fill="currentColor"/><path d="M15.5 8.5c1.33 2.13 1.33 4.87 0 7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M18.5 5.5c2.8 4 2.8 9 0 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  volumeLow:
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12.5 4.3c0-.86-.98-1.34-1.66-.78L6.8 7.5H3.5C2.67 7.5 2 8.17 2 9v6c0 .83.67 1.5 1.5 1.5h3.3l4.04 3.98c.68.56 1.66.08 1.66-.78V4.3z" fill="currentColor"/><path d="M16 9c1.2 1.8 1.2 4.2 0 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  volumeMute:
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12.5 4.3c0-.86-.98-1.34-1.66-.78L6.8 7.5H3.5C2.67 7.5 2 8.17 2 9v6c0 .83.67 1.5 1.5 1.5h3.3l4.04 3.98c.68.56 1.66.08 1.66-.78V4.3z" fill="currentColor"/><path d="M16 9.5l5 5m0-5l-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  pip: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="4" width="20" height="16" rx="3" stroke="currentColor" stroke-width="2"/><rect x="12" y="11" width="7.5" height="6.5" rx="1.5" fill="currentColor"/></svg>',
  fullscreenEnter:
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  fullscreenExit:
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 9h3a2 2 0 0 0 2-2V3m13 6h-3a2 2 0 0 1-2-2V3M3 15h3a2 2 0 0 1 2 2v4m13-6h-3a2 2 0 0 0-2 2v4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
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
    const activePs = getActivePlayerScreen();
    if (activePs && !isScrubbing && !activePs.isDialogOpen?.()) {
      hidePlayerCursor();
      activePs?.setControlsVisible?.(false, { focus: false });
    }
  }, 2500);
}
