import { ProfileSyncService } from "../../../core/profile/profileSyncService.js";
import { ProfileSelectionScreen } from "../../../core/profile/profileSelectionScreen.js";
import { AuthManager } from "../../../core/auth/authManager.js";
import { Router } from "../../../ui/navigation/router.js";

const LOCAL_PINS_KEY = "nuvio_profile_pins";
const LOCAL_PIN_STATES_KEY = "nuvio_profile_pin_states";

function getLocalPins() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_PINS_KEY) || "{}");
  } catch (_) {
    return {};
  }
}

function getLocalPinStates() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_PIN_STATES_KEY) || "{}");
  } catch (_) {
    return {};
  }
}

function saveLocalPin(profileId, pin) {
  try {
    const idStr = String(profileId);
    const pins = getLocalPins();
    const states = getLocalPinStates();
    pins[idStr] = String(pin || "");
    states[idStr] = true;
    localStorage.setItem(LOCAL_PINS_KEY, JSON.stringify(pins));
    localStorage.setItem(LOCAL_PIN_STATES_KEY, JSON.stringify(states));
  } catch (_) {}
}

function removeLocalPin(profileId) {
  try {
    const idStr = String(profileId);
    const pins = getLocalPins();
    const states = getLocalPinStates();
    delete pins[idStr];
    states[idStr] = false;
    localStorage.setItem(LOCAL_PINS_KEY, JSON.stringify(pins));
    localStorage.setItem(LOCAL_PIN_STATES_KEY, JSON.stringify(states));
  } catch (_) {}
}

function verifyLocalPin(profileId, pin) {
  const idStr = String(profileId);
  const pins = getLocalPins();
  const stored = String(pins[idStr] || "").trim();
  const entered = String(pin || "").trim();
  return Boolean(stored.length > 0 && stored === entered);
}

export function installWebProfilePinEngine() {
  if (typeof window === "undefined") return;

  try {
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

export function triggerProfileOptionsDialog(profileCard) {
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
