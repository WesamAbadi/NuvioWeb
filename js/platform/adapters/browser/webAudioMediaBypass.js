import { getActivePlayerScreen } from "./webDesktopPlayerUi.js";

// Bypass WebAudio MediaElementSource capture on HTMLMediaElement in browser mode
// to prevent Chrome CORS MediaElementAudioSource zero-audio restrictions completely.
export function installWebAudioCorsBypass() {
  if (typeof window === "undefined") return;
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

let audioCheckInterval = null;
let lastWarnedVideoSrc = "";

export function initAudioDecodingMonitor() {
  if (audioCheckInterval || typeof window === "undefined") return;

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
