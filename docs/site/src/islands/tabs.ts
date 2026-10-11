function selectTab({ button }: { button: HTMLElement }) {
  const root = button.closest('[data-scope="tabs"][data-part="root"]');
  if (!root) return;
  root.querySelectorAll<HTMLElement>('[role="tab"]').forEach((tab) => {
    if (tab.closest('[data-scope="tabs"][data-part="root"]') !== root) return;
    const selected = tab === button;
    tab.setAttribute("aria-selected", String(selected));
    tab.toggleAttribute("data-selected", selected);
    tab.tabIndex = selected ? 0 : -1;
  });
  const target = button.getAttribute("aria-controls");
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
  const group = root.getAttribute("data-docs-preference");
  if (group) {
    try {
      localStorage.setItem(`lw-docs:${group}`, button.textContent?.trim() ?? "");
    } catch {
      /* Storage is optional. */
    }
  }
}

function onTabClick(event: MouseEvent) {
  if (!(event.target instanceof Element)) return;
  const tab = event.target.closest<HTMLElement>('[role="tab"]');
  if (tab) selectTab({ button: tab });
  const expand = event.target.closest<HTMLElement>("[data-docs-expand]");
  if (!expand) return;
  const expanded = expand.getAttribute("aria-expanded") !== "true";
  expand.setAttribute("aria-expanded", String(expanded));
  expand.textContent = expanded ? "Collapse code" : "Expand code";
  expand.parentElement?.parentElement
    ?.querySelectorAll<HTMLElement>(".docs-code-region")
    .forEach((region) => {
      region.style.maxHeight = expanded ? "none" : "";
    });
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
  buttons[index]?.focus();
  if (buttons[index]) selectTab({ button: buttons[index] });
}

function restoreTabs() {
  document.querySelectorAll("[data-docs-preference]").forEach((root) => {
    let stored;
    try {
      stored = localStorage.getItem(`lw-docs:${root.getAttribute("data-docs-preference")}`);
    } catch {
      return;
    }
    const button = [...root.querySelectorAll<HTMLElement>('[role="tab"]')].find(
      (tab) => tab.textContent?.trim() === stored,
    );
    if (button) selectTab({ button });
  });
}

export function installTabs() {
  restoreTabs();
  document.addEventListener("docs:navigated", restoreTabs);
  document.addEventListener("click", onTabClick);
  document.addEventListener("keydown", onTabKey);
}

installTabs();
