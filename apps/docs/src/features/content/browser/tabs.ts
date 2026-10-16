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
  const root = button.closest('[data-scope="tabs"][data-part="root"]');
  if (!root) return;
  root.querySelectorAll<HTMLElement>('[role="tab"]').forEach((tab) => {
    if (tab.closest('[data-scope="tabs"][data-part="root"]') !== root) return;
    const selected = tab === button;
    tab.setAttribute("aria-selected", String(selected));
    tab.toggleAttribute("data-selected", selected);
    tab.tabIndex = selected ? 0 : -1;
  });
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
  const response = root.closest('section[aria-label="Documented response"]');
  response?.querySelectorAll<HTMLElement>("[data-response-status]").forEach((panel) => {
    panel.hidden = panel.dataset.responseStatus !== button.textContent?.trim();
  });
  const responseCopy = response?.querySelector<HTMLElement>("[data-docs-copy]");
  if (responseCopy)
    responseCopy.hidden = !response?.querySelector(
      "[data-response-status]:not([hidden]) .docs-code-region",
    );
  updateCodeTitle({ root, panelId: target });
  const group = root.getAttribute("data-docs-preference");
  if (group && remember) choosePreference(group, tabLanguage(button));
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
  for (const group of ["sdk-language", "api-language", "package-manager"]) {
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
}

installTabs();
