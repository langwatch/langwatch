/* Carries the navigation rail across in-place page changes: the swapped-in rail keeps the
   reader's scroll and open groups, and opens only what the new page needs. */

type Selection = { x: number; y: number; height: number };
type RailState = {
  section: string;
  scroll: number;
  top: number;
  open: Map<string, boolean>;
  selection: Selection | null;
};

const TREE = 'nav[aria-label="Page navigation"]';
let saved: RailState | null = null;

function rail() {
  return document.querySelector<HTMLElement>(".docs-left-rail");
}

function groups(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLButtonElement>("button[data-docs-group]")];
}

/** Group keys start with their section's title. */
function sectionOf({ root }: { root: HTMLElement }) {
  return groups(root)[0]?.dataset.docsGroup?.split("/")[0] ?? "";
}

function setOpen({ button, open }: { button: HTMLButtonElement; open: boolean }) {
  button.setAttribute("aria-expanded", String(open));
  const panel = button.nextElementSibling;
  if (panel instanceof HTMLElement) panel.hidden = !open;
}

/** Where the page tree starts inside the rail's scrolled content. */
function treeOffset({ root }: { root: HTMLElement }) {
  const tree = root.querySelector(TREE);
  if (!tree) return 0;
  return tree.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
}

/** Scrolls the rail, never the document, so the current page's link is in view. */
function revealCurrent({ root }: { root: HTMLElement }) {
  const link = root.querySelector<HTMLElement>(`${TREE} [aria-current="page"]`);
  if (!link) return;
  const bounds = root.getBoundingClientRect();
  const visibleBottom = Math.min(bounds.bottom, innerHeight);
  const target = link.getBoundingClientRect();
  if (target.top >= bounds.top && target.bottom <= visibleBottom) return;
  root.scrollTop += target.top - bounds.top - (visibleBottom - bounds.top - target.height) / 2;
}

function selection() {
  const tree = rail()?.querySelector<HTMLElement>(TREE);
  const link = tree?.querySelector<HTMLElement>('[aria-current="page"]');
  if (!tree || !link) return null;
  const parent = tree.getBoundingClientRect();
  const target = link.getBoundingClientRect();
  return {
    x: target.left - parent.left - 8,
    y: target.top - parent.top + 6,
    height: Math.max(0, target.height - 12),
  };
}

function markCurrent(previous: Selection | null = null) {
  const tree = rail()?.querySelector<HTMLElement>(TREE);
  const target = selection();
  if (!tree || !target) return;
  let marker = tree.querySelector<HTMLElement>(".docs-nav-indicator");
  if (!marker) {
    marker = document.createElement("span");
    marker.className = "docs-nav-indicator";
    marker.setAttribute("aria-hidden", "true");
    tree.append(marker);
  }
  tree.dataset.indicatorReady = "";
  marker.style.height = `${target.height}px`;
  const transform = `translate(${target.x}px, ${target.y}px)`;
  marker.style.transform = transform;
  if (previous && matchMedia("(prefers-reduced-motion: no-preference)").matches) {
    marker.animate(
      [
        {
          transform: `translate(${previous.x}px, ${previous.y}px)`,
          height: `${previous.height}px`,
        },
        { transform, height: `${target.height}px` },
      ],
      { duration: 220, easing: "ease-in-out" },
    );
  }
}

function remember() {
  const root = rail();
  if (!root) return;
  saved = {
    selection: selection(),
    section: sectionOf({ root }),
    scroll: root.scrollTop,
    top: root.getBoundingClientRect().top,
    open: new Map(
      groups(root).map((button) => [
        button.dataset.docsGroup ?? "",
        button.getAttribute("aria-expanded") === "true",
      ]),
    ),
  };
}

function restore() {
  const root = rail();
  const state = saved;
  saved = null;
  if (!root || !state) return;
  for (const button of groups(root)) {
    const open = state.open.get(button.dataset.docsGroup ?? "");
    const holdsCurrent = button.nextElementSibling?.querySelector('[aria-current="page"]');
    if (open !== undefined && !holdsCurrent) setOpen({ button, open });
  }
  // A new section keeps the section links in place and shows the start of its own tree.
  const scroll =
    sectionOf({ root }) === state.section
      ? state.scroll
      : Math.min(state.scroll, treeOffset({ root }));
  root.scrollTop = scroll;
  // Navigation scrolls the document next; before that frame paints, offset the rail's own
  // scroll by however far its sticky box moved, so every link stays where the reader saw it.
  requestAnimationFrame(() => {
    root.scrollTop = scroll + root.getBoundingClientRect().top - state.top;
    revealCurrent({ root });
    markCurrent(sectionOf({ root }) === state.section ? state.selection : null);
  });
}

export function installSidebar() {
  document.addEventListener("docs:leaving", remember);
  document.addEventListener("docs:navigated", restore);
  const root = rail();
  if (root) revealCurrent({ root });
  markCurrent();
  void document.fonts.ready.then(() => markCurrent());
  document.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("[data-docs-group]")) {
      requestAnimationFrame(() => markCurrent());
    }
  });
}
