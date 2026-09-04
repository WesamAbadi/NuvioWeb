import { Router } from "../../../ui/navigation/router.js";
import { FocusEngine } from "../../../ui/navigation/focusEngine.js";
import { Platform } from "../../index.js";
import {
  PosterOptionsDialogController,
  posterItemFromNode
} from "../../../ui/components/posterOptionsMenu.js";
import {
  setModernSidebarExpanded,
  setLegacySidebarExpanded
} from "../../../ui/components/sidebarNavigation.js";
import {
  getActivePlayerScreen,
  unmuteAndUnlockAudio,
  showVolumeToast,
  syncVolumeUi,
  saveWebVolumeState,
  updateTimelineTooltip,
  removeTimelineTooltip,
  getIsScrubbing,
  setIsScrubbing,
  showPlayerCursor,
  resetPlayerCursorTimer
} from "./webDesktopPlayerUi.js";
import {
  handleRowDragStart,
  handleRowDragMove,
  handleRowDragEnd,
  hasRowDragged,
  ensureRowNavigationChevrons
} from "./webCarouselChevrons.js";
import { handleDetailPointerClick } from "./webDetailActions.js";
import { triggerProfileOptionsDialog } from "./webProfilePinStorage.js";

let lastClickTime = 0;
let lastClickTarget = null;
let profileHoldTimer = null;
let profileHoldTargetCard = null;
let adapterPosterOptionsController = null;

export function hasActiveModal() {
  return Boolean(
    document.body?.classList?.contains("nuvio-modal-open") ||
    document.querySelector(
      ".nuvio-dialog-backdrop, .profile-pin-overlay, .player-post-play-synopsis-overlay, [data-player-post-play-modal]"
    )
  );
}

export function isEditableTarget(target) {
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

export function findFocusableTarget(node) {
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

export function triggerFallbackActivation(target, currentScreen, event) {
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

  if (
    !enterEvent.defaultPrevented &&
    !target.isConnected &&
    typeof currentScreen?.onKeyDown === "function"
  ) {
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

  if (
    !enterKeyUp.defaultPrevented &&
    !target.isConnected &&
    typeof currentScreen?.onKeyUp === "function"
  ) {
    const normalizedUp = Platform.normalizeKey(enterKeyUp);
    normalizedUp.target = target;
    try {
      currentScreen.onKeyUp(normalizedUp);
    } catch (e) {
      console.warn("Screen onKeyUp fallback error:", e);
    }
  }
}

export async function triggerPosterOptionsMenu(card) {
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

export function ensureSearchInputClearButton() {
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

export function handleMouseLeaveSidebar() {
  const currentScreen = Router.getCurrentScreen();
  const container = currentScreen?.container || document;

  setModernSidebarExpanded(container, false);
  setLegacySidebarExpanded(container, false);
  if (typeof currentScreen?.closeSidebarToContent === "function") {
    currentScreen.closeSidebarToContent();
  }
}

export function handlePointerDown(event) {
  unmuteAndUnlockAudio();
  if (event.button !== 0) return;

  handleRowDragStart(event);

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
      setIsScrubbing(true);
      progressShell.classList.add("is-scrubbing");
      event.preventDefault();
      event.stopPropagation();
      playerScreen.seekProgressFromPointer?.(event, progressShell);
      updateTimelineTooltip(event, playerScreen, progressShell);
    }
  }
}

export function handlePointerUp() {
  if (profileHoldTimer) {
    clearTimeout(profileHoldTimer);
    profileHoldTimer = null;
  }
  profileHoldTargetCard = null;

  handleRowDragEnd();

  if (getIsScrubbing()) {
    setIsScrubbing(false);
    const playerScreen = getActivePlayerScreen();
    const progressShell = document.querySelector(".player-progress-shell");
    if (progressShell) {
      progressShell.classList.remove("is-scrubbing");
    }
    removeTimelineTooltip(playerScreen);
  }
}

export async function handleContextMenu(event) {
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
  }
}

export function handleAuxClick(event) {
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

export function handlePointerClick(event) {
  unmuteAndUnlockAudio();
  if (event.button === 2) return;

  if (hasRowDragged()) {
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

    if (typeof playerScreen.isDialogOpen === "function" && playerScreen.isDialogOpen()) {
      const dialogContainer = rawTarget.closest(
        ".player-modal, #playerSubtitleDialog, #playerAudioDialog, #playerSpeedDialog, " +
          ".player-sources-panel, .player-sources-drawer, .player-episode-panel, #episodeSidePanel, " +
          ".player-dialog"
      );

      if (!dialogContainer) {
        // User clicked outside the open dialog (e.g. on backdrop, video, or outside control bar)
        // Close dialog without toggling playback or dispatching enter
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        playerScreen.closeSubtitleDialog?.();
        playerScreen.closeAudioDialog?.();
        playerScreen.closeSpeedDialog?.();
        playerScreen.hideSourcesPanel?.();
        playerScreen.hideEpisodePanel?.();
        return;
      }

      // User clicked INSIDE the open dialog
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const dialogItem = rawTarget.closest(
        ".player-dialog-item, .player-dialog-step, .player-sources-item, " +
          "[data-subtitle-rail], [data-audio-column], [data-speed-index], [data-sources-zone], " +
          "[data-episode-action], [data-episode-stream-index], [data-episode-season-index], [data-episode-index], " +
          ".focusable, button"
      );

      if (dialogItem) {
        // Handle Subtitle items directly
        const subtitleRailNode = dialogItem.dataset?.subtitleRail
          ? dialogItem
          : dialogItem.closest("[data-subtitle-rail]");
        if (subtitleRailNode) {
          const rail = subtitleRailNode.dataset.subtitleRail;
          const index = Number(subtitleRailNode.dataset.subtitleIndex || 0);

          if (
            dialogItem.dataset?.subtitleStyleAction ||
            dialogItem.closest("[data-subtitle-style-action]")
          ) {
            playerScreen.onPointerActivate?.(dialogItem, event);
          } else if (rail === "language") {
            const languages = playerScreen.getSubtitleLanguageRailItems?.() || [];
            const lang = languages[index];
            if (lang) {
              playerScreen.subtitleFocusedRail = "language";
              playerScreen.subtitleLanguageRailIndex = index;
              playerScreen.subtitleFocusedLanguageKey = lang.key;
              if (lang.key === "off" || lang.id === "subtitle-off") {
                const offEntry = playerScreen
                  .getSubtitleEntries?.("builtIn")
                  ?.find?.((e) => e.id === "subtitle-off") || {
                  trackIndex: -1
                };
                playerScreen.applySubtitleEntry?.(offEntry);
              } else {
                const selected = playerScreen.selectFirstSubtitleOptionForLanguage?.(lang.key, {
                  focusOptions: true
                });
                if (!selected) {
                  const nextOptions = playerScreen.getSubtitleOptionsForLanguage?.(lang.key) || [];
                  if (nextOptions.length) {
                    playerScreen.subtitleFocusedRail = "options";
                    playerScreen.subtitleOptionRailIndex = 0;
                  }
                }
              }
              playerScreen.renderSubtitleDialog?.();
            }
          } else if (rail === "options") {
            const selectedLang = playerScreen.getSelectedSubtitleLanguageKey?.();
            const options = playerScreen.getSubtitleOptionsForLanguage?.(selectedLang) || [];
            const option = options[index];
            playerScreen.subtitleFocusedRail = "options";
            playerScreen.subtitleOptionRailIndex = index;
            if (option?.entry) {
              playerScreen.applySubtitleEntry?.(option.entry);
            }
            playerScreen.renderSubtitleDialog?.();
          } else if (rail === "style") {
            playerScreen.subtitleFocusedRail = "style";
            playerScreen.subtitleStyleRailIndex = index;
            playerScreen.renderSubtitleDialog?.();
          }
          return;
        }

        // Handle Audio items directly
        const audioColNode = dialogItem.dataset?.audioColumn
          ? dialogItem
          : dialogItem.closest("[data-audio-column]");
        if (audioColNode) {
          const col = audioColNode.dataset.audioColumn || "tracks";
          const index = Number(audioColNode.dataset.audioIndex || 0);
          playerScreen.audioFocusedColumn = col;
          if (col === "tracks") {
            playerScreen.audioDialogIndex = index;
            playerScreen.applyAudioTrack?.(index, { rememberSelection: true });
          } else {
            playerScreen.audioMixFocusIndex = index;
            const audioStepNode =
              dialogItem.dataset?.audioStep !== undefined
                ? dialogItem
                : dialogItem.closest("[data-audio-step]");
            if (audioStepNode) {
              playerScreen.activateAudioControl?.(Number(audioStepNode.dataset.audioStep || 1));
            } else {
              playerScreen.activateAudioControl?.(index === 0 ? 1 : 0);
            }
          }
          playerScreen.renderAudioDialog?.();
          return;
        }

        // Handle Speed items directly
        const speedNode =
          dialogItem.dataset?.speedIndex !== undefined
            ? dialogItem
            : dialogItem.closest("[data-speed-index]");
        if (speedNode) {
          const index = Number(speedNode.dataset.speedIndex || 0);
          const speedOptions = playerScreen.getPlaybackSpeedOptions?.() || [];
          playerScreen.speedDialogIndex = index;
          playerScreen.applyPlaybackSpeed?.(speedOptions[index] || 1);
          playerScreen.renderSpeedDialog?.();
          return;
        }

        // Other dialog elements (sources panel, episode panel, etc.)
        playerScreen.syncPointerFocus?.(dialogItem);
        playerScreen.onPointerActivate?.(dialogItem, event);
      }
      return;
    }

    const isControlClick = Boolean(
      rawTarget.closest(
        ".player-control-btn, .player-control-button, .player-action-btn, .player-progress-shell, " +
          ".player-modal, .player-subtitle-modal, .player-audio-modal, .player-speed-modal, " +
          "#playerSubtitleDialog, #playerAudioDialog, #playerSpeedDialog, " +
          ".player-subtitle-overlay-grid, .player-subtitle-rail, .player-dialog-step, " +
          ".player-audio-track-list, .player-dialog, .player-sources-panel, .player-sources-drawer, " +
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

  // 2. Settings & Trakt screens manage their own click events and section switching natively via handleClickEvent
  const isSettingsOrTrakt =
    Router.getCurrent?.() === "settings" ||
    Router.getCurrent?.() === "trakt" ||
    currentScreen?.name === "settings" ||
    currentScreen?.name === "trakt" ||
    Boolean(
      target.closest(
        "#settings, .settings-shell, .settings-container, .settings-screen, #trakt, .trakt-screen"
      )
    );
  if (isSettingsOrTrakt) {
    return;
  }

  // 3. Sidebar items and dialog buttons manage their clicks natively
  if (
    target.closest(
      ".sidebar-item, .modern-sidebar-item, .modern-sidebar-pill, [data-settings-root-sidebar], [data-root-sidebar], .nuvio-dialog-btn"
    )
  ) {
    return;
  }

  // 4. Allow onPointerActivate if provided by the screen
  if (typeof currentScreen?.onPointerActivate === "function") {
    Promise.resolve(currentScreen.onPointerActivate(target, event))
      .then((handled) => {
        if (!handled && !currentScreen.isDialogOpen?.()) {
          triggerFallbackActivation(target, currentScreen, event);
        }
      })
      .catch(() => {
        if (!currentScreen.isDialogOpen?.()) {
          triggerFallbackActivation(target, currentScreen, event);
        }
      });
    return;
  }

  // 5. Fallback activation (Enter keydown + keyup on focused node)
  if (!currentScreen?.isDialogOpen?.()) {
    triggerFallbackActivation(target, currentScreen, event);
  }
}

export function handlePointerMove(event) {
  if (handleRowDragMove(event)) {
    return;
  }

  const hoveredRow = event.target?.closest?.(
    ".home-row-cards, .catalog-cards-row, .collection-items-row, .meta-cast-row, .series-episode-track, .series-insight-tabs, [data-scroll-row], .horizontal-scroll"
  );
  if (hoveredRow) {
    ensureRowNavigationChevrons(hoveredRow);
  }

  const playerScreen = getActivePlayerScreen();
  if (playerScreen) {
    unmuteAndUnlockAudio();
    resetPlayerCursorTimer(playerScreen);

    const progressShell =
      event.target?.closest?.(".player-progress-shell") ||
      document.querySelector(".player-progress-shell");

    if (getIsScrubbing() && progressShell) {
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
    showPlayerCursor();
    removeTimelineTooltip();
  }
}

export function handleDoubleClick(event) {
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

export function handleKeyDown(event) {
  unmuteAndUnlockAudio();
  const target = event.target;
  const playerScreen = getActivePlayerScreen();

  if (playerScreen && !isEditableTarget(target)) {
    showPlayerCursor();

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
  }
}

export function handleWheel(event) {
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
      ".player-sources-drawer, .player-dialog, .player-modal, .player-subtitle-modal, .player-audio-modal, " +
      ".player-speed-modal, .player-subtitle-rail, .player-audio-track-list, " +
      ".nuvio-dialog-body, .sidebar-container, [data-scroll-container]"
  );
  if (scrollable && scrollable.scrollHeight > scrollable.clientHeight) {
    scrollable.scrollTop += event.deltaY;
    return;
  }

  // 5. General scrollable element fallback (excluding fixed screen containers)
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

export function attachBrowserInputListeners() {
  if (typeof window === "undefined") return;

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
          handleMouseLeaveSidebar();
        }
      }
    },
    true
  );
}
