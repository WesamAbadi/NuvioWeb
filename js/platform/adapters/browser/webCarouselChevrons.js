const CHEVRON_ICONS = {
  left: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>',
  right:
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>'
};

export const HORIZONTAL_ROW_SELECTOR =
  ".home-row-cards, .catalog-cards-row, .collection-items-row, " +
  ".meta-cast-row, .series-episode-track, .series-insight-tabs, [data-scroll-row], .horizontal-scroll";

let activeDragRow = null;
let dragStartX = 0;
let dragStartScrollLeft = 0;
let hasDragged = false;

export function updateRowChevrons(row) {
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

export function ensureRowNavigationChevrons(row) {
  if (!row || row.scrollWidth <= row.clientWidth + 20) return;
  const container =
    row.closest(".home-row, .catalog-row, .series-episodes-section, .meta-cast-section") ||
    row.parentElement;
  if (!container || container.querySelector(".web-carousel-arrow")) return;

  const prevBtn = document.createElement("button");
  prevBtn.className = "web-carousel-arrow web-carousel-prev";
  prevBtn.type = "button";
  prevBtn.setAttribute("aria-label", "Scroll left");
  prevBtn.innerHTML = CHEVRON_ICONS.left;
  prevBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    row.scrollBy({ left: -row.clientWidth * 0.75, behavior: "smooth" });
  };

  const nextBtn = document.createElement("button");
  nextBtn.className = "web-carousel-arrow web-carousel-next";
  nextBtn.type = "button";
  nextBtn.setAttribute("aria-label", "Scroll right");
  nextBtn.innerHTML = CHEVRON_ICONS.right;
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

export function handleRowDragStart(event) {
  if (event.button !== 0) return;
  const row = event.target?.closest?.(HORIZONTAL_ROW_SELECTOR);
  if (row && row.scrollWidth > row.clientWidth) {
    activeDragRow = row;
    dragStartX = event.clientX;
    dragStartScrollLeft = row.scrollLeft;
    hasDragged = false;
  }
}

export function handleRowDragMove(event) {
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
      return true;
    }
  }
  return false;
}

export function handleRowDragEnd() {
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
}

export function hasRowDragged() {
  return hasDragged;
}
