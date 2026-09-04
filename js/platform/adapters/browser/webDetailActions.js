export function handleDetailPointerClick(target, event, currentScreen) {
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
