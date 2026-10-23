const ROOT = '[data-scope="tabs"][data-part="root"]';

const preferences = new Map<string, string>();

function preference(group: string): string | null {
  try {
    return preferences.get(group) ?? localStorage.getItem(`lw-docs:${group}`);
  } catch {
    return preferences.get(group) ?? null;
  }
}

function tabLanguage(tab: HTMLElement): string {
  return tab.dataset.docsLanguage ?? tab.textContent?.trim() ?? "";
}

function applyPreference(group: string, value: string) {
  document.querySelectorAll<HTMLElement>("[data-docs-preference]").forEach((root) => {
    if (root.dataset.docsPreference !== group) return;
    const button = [...root.querySelectorAll<HTMLElement>('[role="tab"]')].find(
      (tab) =>
        tab.closest("[data-docs-preference]") === root &&
        tabLanguage(tab).toLowerCase() === value.toLowerCase(),
    );
    if (button) selectTab({ button, remember: false });
  });
}

function savePreference(group: string, value: string) {
  preferences.set(group, value);
  try {
    localStorage.setItem(`lw-docs:${group}`, value);
  } catch {
    // The in-memory choice still applies while navigating this tab.
  }
  window.dispatchEvent(new CustomEvent("lw-docs-pref", { detail: { key: group, value } }));
  applyPreference(group, value);
}

function choosePreference(group: string, value: string) {
  if (group === "sdk-language" || group === "api-language") {
    savePreference("sdk-language", value);
    savePreference("api-language", value);
  } else savePreference(group, value);
}

const FAMILY = "code-language";
/* The playground's request tabs keep their own stored label. */
const API_LABELS: Record<string, string> = {
  python: "Python",
  typescript: "TypeScript",
  shell: "curl",
};

/** Selects the family in every group offering it, unless that group already shows it. */
function applyFamily(family: string) {
  document.querySelectorAll<HTMLElement>(ROOT).forEach((root) => {
    const matching = [...root.querySelectorAll<HTMLElement>('[role="tab"]')].filter(
      (tab) => tab.closest(ROOT) === root && tab.dataset.docsFamily === family,
    );
    if (matching.some((tab) => tab.getAttribute("aria-selected") === "true")) return;
    if (matching[0]) selectTab({ button: matching[0], remember: false });
  });
}

function chooseFamily(family: string) {
  preferences.set(FAMILY, family);
  try {
    localStorage.setItem(`lw-docs:${FAMILY}`, family);
  } catch {
    // The in-memory choice still applies while navigating this tab.
  }
  const label = API_LABELS[family];
  if (label) savePreference("api-language", label);
  applyFamily(family);
}

/** Groups above the clicked tab change height; scroll by the difference so the tab stays put. */
function keepInPlace({ button, change }: { button: HTMLElement; change: () => void }) {
  const before = button.getBoundingClientRect().top;
  change();
  const shift = button.getBoundingClientRect().top - before;
  if (Math.abs(shift) >= 1) window.scrollBy({ top: shift, behavior: "instant" });
}

function revealTab(button: HTMLElement) {
  const list = button.closest<HTMLElement>('[role="tablist"]');
  if (list) {
    const item = button.getBoundingClientRect();
    const bounds = list.getBoundingClientRect();
    if (item.left < bounds.left) list.scrollLeft += item.left - bounds.left;
    else if (item.right > bounds.right) list.scrollLeft += item.right - bounds.right;
  }
}

function selectTab({ button, remember = true }: { button: HTMLElement; remember?: boolean }) {
  const root = button.closest(ROOT);
  if (!root) return;
  markSelected({ root, button });
  revealTab(button);
  measureTabLists();
  const target = [...root.querySelectorAll<HTMLElement>('[role="tabpanel"]')].find(
    (panel) => panel.getAttribute("aria-labelledby") === button.id,
  )?.id;
  if (target) button.setAttribute("aria-controls", target);
  root.querySelectorAll<HTMLElement>('[role="tabpanel"]').forEach((panel) => {
    if (panel.closest('[data-scope="tabs"][data-part="root"]') !== root) return;
    panel.hidden = panel.id !== target;
    panel.dataset.state = panel.hidden ? "closed" : "open";
  });
  showResponse({ root, button });
  updateCodeTitle({ root, panelId: target });
  const group = root.getAttribute("data-docs-preference");
  const family = button.dataset.docsFamily;
  if (!remember || (!family && !group)) return;
  keepInPlace({
    button,
    change: () => {
      if (family) chooseFamily(family);
      else if (group) choosePreference(group, tabLanguage(button));
    },
  });
}

function markSelected({ root, button }: { root: Element; button: HTMLElement }) {
  root.querySelectorAll<HTMLElement>('[role="tab"]').forEach((tab) => {
    if (tab.closest(ROOT) !== root) return;
    const selected = tab === button;
    tab.setAttribute("aria-selected", String(selected));
    tab.toggleAttribute("data-selected", selected);
    tab.tabIndex = selected ? 0 : -1;
  });
}

/** A documented response's status tabs show that status's body and its copy action. */
function showResponse({ root, button }: { root: Element; button: HTMLElement }) {
  const response = root.closest('section[aria-label="Documented response"]');
  if (!response) return;
  response.querySelectorAll<HTMLElement>("[data-response-status]").forEach((panel) => {
    panel.hidden = panel.dataset.responseStatus !== button.textContent?.trim();
  });
  const responseCopy = response.querySelector<HTMLElement>("[data-docs-copy]");
  if (responseCopy)
    responseCopy.hidden = !response.querySelector(
      "[data-response-status]:not([hidden]) .docs-code-region",
    );
}

function updateCodeTitle({ root, panelId }: { root: Element; panelId?: string }) {
  const title = root.querySelector<HTMLElement>("[data-docs-code-title]");
  const panel = panelId ? document.getElementById(panelId) : null;
  if (title && panel?.dataset.codeTitle) title.textContent = panel.dataset.codeTitle;
}

function onTabClick(event: MouseEvent) {
  if (!(event.target instanceof Element)) return;
  const tab = event.target.closest<HTMLElement>('[role="tab"]');
  if (tab) selectTab({ button: tab });
}

function onTabKey(event: KeyboardEvent) {
  if (!(event.target instanceof HTMLElement) || event.target.getAttribute("role") !== "tab") return;
  const buttons = [
    ...(event.target.closest('[role="tablist"]')?.querySelectorAll<HTMLElement>('[role="tab"]') ??
      []),
  ];
  let index = buttons.indexOf(event.target);
  if (event.key === "ArrowRight") index = (index + 1) % buttons.length;
  else if (event.key === "ArrowLeft") index = (index + buttons.length - 1) % buttons.length;
  else if (event.key === "Home") index = 0;
  else if (event.key === "End") index = buttons.length - 1;
  else return;
  event.preventDefault();
  buttons[index]?.focus({ preventScroll: true });
  if (buttons[index]) selectTab({ button: buttons[index] });
}

/** Number keys pick a tab in the group under the pointer, holding focus, or first on screen. */
function onDigitKey(event: KeyboardEvent) {
  if (!/^[1-9]$/.test(event.key) || event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest("input, textarea, select, [contenteditable], dialog")) return;
  const roots = [...document.querySelectorAll<HTMLElement>(ROOT)];
  const root =
    roots.findLast((node) => node.matches(":hover")) ??
    target?.closest<HTMLElement>(ROOT) ??
    roots.find((node) => {
      const box = node.getBoundingClientRect();
      return box.bottom > 80 && box.top < innerHeight;
    });
  const tabs = [...(root?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])].filter(
    (tab) => tab.closest(ROOT) === root,
  );
  const button = tabs[Number(event.key) - 1];
  if (!button) return;
  event.preventDefault();
  selectTab({ button });
}

function measureTabLists() {
  document.querySelectorAll<HTMLElement>('[role="tablist"]').forEach((list) => {
    list.toggleAttribute(
      "data-overflow",
      list.scrollWidth > list.clientWidth + list.scrollLeft + 2,
    );
  });
}

function restoreTabs() {
  measureTabLists();
  const family = preference(FAMILY);
  if (family) applyFamily(family);
  const groups = family ? ["package-manager"] : ["sdk-language", "api-language", "package-manager"];
  for (const group of groups) {
    const stored = preference(group);
    if (stored) applyPreference(group, stored);
  }
}

export function installTabs() {
  restoreTabs();
  document.addEventListener("docs:navigated", restoreTabs);
  window.addEventListener("resize", measureTabLists);
  document.addEventListener("scroll", measureTabLists, { capture: true, passive: true });
  void document.fonts.ready.then(measureTabLists);
  document.addEventListener("click", onTabClick);
  document.addEventListener("keydown", onTabKey);
  document.addEventListener("keydown", onDigitKey);
}

installTabs();
