import { isBackEvent, normalizeKeyEvent } from "../sharedKeys.js";
import { initWebInputAdapter } from "./browser/webInputAdapter.js";

// Top-level side effect ensures esbuild never tree-shakes web input adapter module
try {
  initWebInputAdapter();
} catch (_) {}

export const browserAdapter = {
  name: "browser",

  init() {
    initWebInputAdapter();
  },

  exitApp() {
    try {
      globalThis.close?.();
    } catch (_) {
      // Browsers commonly block window.close(); ignore that.
    }
  },

  isBackEvent(event) {
    return isBackEvent(event, [461, 10009, 27, 8]);
  },

  normalizeKey(event) {
    return normalizeKeyEvent(event, [461, 10009, 27, 8]);
  },

  getDeviceLabel() {
    return "Web Browser";
  },

  getCapabilities() {
    return {
      hlsJs: Boolean(globalThis.Hls?.isSupported?.()),
      dashJs: Boolean(globalThis.dashjs?.MediaPlayer),
      nativeVideo: true,
      webosAvplay: false,
      tizenAvplay: false
    };
  },

  prepareVideoElement() {}
};
