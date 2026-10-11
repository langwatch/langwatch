function closeMenus() {
  document.querySelectorAll<HTMLElement>(".docs-menu").forEach((menu) => {
    menu.hidden = true;
    menu.previousElementSibling?.setAttribute("aria-expanded", "false");
  });
}

function applyTheme({ choice }: { choice: string }) {
  const dark =
    choice === "dark" ||
    (choice === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.classList.toggle("light", !dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  try {
    localStorage.setItem("theme", choice);
  } catch {
    /* Storage is optional. */
  }
}

function openMobile() {
  const dialog = document.getElementById("docs-mobile-nav");
  if (!(dialog instanceof HTMLDialogElement)) return;
  dialog.showModal();
  const active = dialog.querySelector<HTMLElement>('[aria-current="page"]');
  active?.focus({ preventScroll: true });
  active?.scrollIntoView({ block: "nearest" });
}

function onMenuClick(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target : null;
  const trigger = target?.closest<HTMLElement>("[data-docs-theme], [data-docs-page-menu]");
  if (trigger) {
    const menu = trigger.nextElementSibling;
    if (!(menu instanceof HTMLElement)) return;
    const wasOpen = !menu.hidden;
    closeMenus();
    menu.hidden = wasOpen;
    trigger.setAttribute("aria-expanded", String(!wasOpen));
    if (!wasOpen) menu.querySelector<HTMLElement>("button,a")?.focus();
    return;
  }
  const choice = target?.closest<HTMLElement>("[data-theme]");
  if (choice?.dataset.theme) {
    applyTheme({ choice: choice.dataset.theme });
    choice
      .closest(".docs-menu")
      ?.querySelectorAll("[data-theme]")
      .forEach((node) => node.setAttribute("aria-checked", String(node === choice)));
    const trigger = choice.closest(".docs-menu")?.previousElementSibling;
    if (trigger instanceof HTMLElement) trigger.focus();
  }
  closeMenus();
  if (target?.closest("[data-docs-mobile]")) openMobile();
  if (target?.closest("[data-docs-mobile-close]")) {
    const dialog = document.getElementById("docs-mobile-nav");
    if (dialog instanceof HTMLDialogElement) dialog.close();
  }
}

function onMenuKey(event: KeyboardEvent) {
  const menu =
    event.target instanceof Element ? event.target.closest<HTMLElement>(".docs-menu") : null;
  if (!menu) return;
  if (event.key === "Escape") {
    const trigger = menu.previousElementSibling;
    closeMenus();
    if (trigger instanceof HTMLElement) trigger.focus();
  }
  if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
  const items = [...menu.querySelectorAll<HTMLElement>("button,a")];
  const index = items.findIndex((item) => item === document.activeElement);
  event.preventDefault();
  items[(index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
}

export function installMenus() {
  document.addEventListener("click", onMenuClick);
  document.addEventListener("keydown", onMenuKey);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    try {
      if (!localStorage.getItem("theme") || localStorage.getItem("theme") === "system")
        applyTheme({ choice: "system" });
    } catch {
      /* The current theme is retained. */
    }
  });
}

installMenus();
