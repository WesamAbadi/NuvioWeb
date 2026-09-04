import { Router } from "../../../ui/navigation/router.js";

export function syncHashWithRoute(routeName, params = {}) {
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

export function parseHashRoute() {
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

export function initWebRouterHistory() {
  if (typeof Router === "undefined" || Router._webHistoryPatched || typeof window === "undefined") {
    return;
  }
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
