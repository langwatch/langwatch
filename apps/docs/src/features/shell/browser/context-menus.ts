import { sitePath } from "../../../lib/site-path.ts";

const GUTTER = 6;
const EDGE = 8;
const ITEM = '[role^="menuitem"]';

type ShowPopoverOptions = { source: HTMLElement };

type PageMenu = {
  trigger: HTMLElement;
  popover: HTMLElement;
  content: HTMLElement;
  /** When the menu last closed, so the click that light-dismissed it does not reopen it. */
  closedAt: number;
};

const menus = new WeakMap<HTMLElement, PageMenu>();

/** The prerendered menu beside a trigger, moved out of its template into a popover once. */
function pageMenu({ trigger }: { trigger: HTMLElement }): PageMenu | null {
  const known = menus.get(trigger);
  if (known) return known;
  const template = trigger.parentElement?.querySelector("template");
  const popover = template?.content.firstElementChild?.cloneNode(true);
  if (!(popover instanceof HTMLElement)) return null;
  const content = popover.querySelector<HTMLElement>('[role="menu"]');
  if (!content) return null;
  popover.removeAttribute("style");
  popover.classList.add("docs-menu-popover");
  popover.popover = "auto";
  content.tabIndex = -1;
  content.removeAttribute("aria-labelledby");
  for (const [position, item] of items({ content }).entries()) {
    item.id ||= `docs-page-menu-${position}`;
    item.tabIndex = -1;
  }
  const menu: PageMenu = { trigger, popover, content, closedAt: 0 };
  popover.addEventListener("toggle", (event) => {
    const open = (event as ToggleEvent).newState === "open";
    trigger.setAttribute("aria-expanded", String(open));
    if (open) return;
    menu.closedAt = performance.now();
    highlight({ menu, item: null });
    if (!document.activeElement || popover.contains(document.activeElement))
      trigger.focus({ preventScroll: true });
  });
  content.addEventListener("keydown", (event) => onKey({ menu, event }));
  content.addEventListener("pointermove", (event) => {
    const item = event.target instanceof Element ? event.target.closest<HTMLElement>(ITEM) : null;
    if (item) highlight({ menu, item });
  });
  content.addEventListener("click", (event) => {
    const item = event.target instanceof Element ? event.target.closest<HTMLElement>(ITEM) : null;
    if (item) choose({ menu, item });
  });
  template?.after(popover);
  trigger.closest<HTMLElement>("[data-docs-menu-root]")?.setAttribute("data-mounted", "");
  menus.set(trigger, menu);
  return menu;
}

function items({ content }: { content: HTMLElement }) {
  return [...content.querySelectorAll<HTMLElement>(ITEM)];
}

function highlight({ menu, item }: { menu: PageMenu; item: HTMLElement | null }) {
  for (const other of items({ content: menu.content }))
    other.toggleAttribute("data-highlighted", other === item);
  if (item) menu.content.setAttribute("aria-activedescendant", item.id);
  else menu.content.removeAttribute("aria-activedescendant");
}

/** Below the trigger's end edge, flipped above when it would run off the bottom. */
function place({ menu }: { menu: PageMenu }) {
  const anchor = menu.trigger.getBoundingClientRect();
  const { width, height } = menu.popover.getBoundingClientRect();
  const below = anchor.bottom + GUTTER;
  const fitsBelow = below + height <= innerHeight - EDGE || anchor.top - GUTTER - height < EDGE;
  const left = Math.min(Math.max(anchor.right - width, EDGE), innerWidth - width - EDGE);
  menu.popover.style.left = `${left}px`;
  menu.popover.style.top = `${fitsBelow ? below : anchor.top - GUTTER - height}px`;
}

function open({ menu, fromKeyboard }: { menu: PageMenu; fromKeyboard: boolean }) {
  /* The source makes the trigger part of the menu for light dismiss where browsers support it. */
  menu.popover.showPopover({ source: menu.trigger } as ShowPopoverOptions);
  place({ menu });
  menu.content.focus({ preventScroll: true });
  highlight({ menu, item: fromKeyboard ? (items({ content: menu.content })[0] ?? null) : null });
}

function onKey({ menu, event }: { menu: PageMenu; event: KeyboardEvent }) {
  const list = items({ content: menu.content });
  const current = list.findIndex((item) => item.hasAttribute("data-highlighted"));
  const moves: Record<string, number> = {
    ArrowDown: (current + 1) % list.length,
    ArrowUp: (current - 1 + list.length) % list.length,
    Home: 0,
    End: list.length - 1,
  };
  const next = moves[event.key];
  if (next !== undefined) {
    event.preventDefault();
    highlight({ menu, item: list[next] ?? null });
    list[next]?.scrollIntoView({ block: "nearest" });
  } else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    list[current]?.click();
  } else if (event.key === "Tab") {
    menu.popover.hidePopover();
  }
}

async function copyText({ value, slug }: { value: string; slug: string }) {
  if (value !== "page") return value;
  const response = await fetch(sitePath({ path: `/${slug}.md` }), { credentials: "omit" });
  if (!response.ok) throw new Error("Markdown unavailable");
  return response.text();
}

async function copyAction({
  menu,
  item,
  value,
}: {
  menu: PageMenu;
  item: HTMLElement;
  value: string;
}) {
  const slug =
    menu.trigger.closest<HTMLElement>("[data-docs-menu-root]")?.dataset.slug ?? "introduction";
  const output = menu.content.querySelector("output");
  if (!output) return;
  try {
    await navigator.clipboard.writeText(await copyText({ value, slug }));
    for (const other of items({ content: menu.content }))
      markCopied({ item: other, on: other === item });
    output.className = "docs-sr-only";
    output.textContent = "Copied to clipboard";
  } catch {
    output.className = "docs-copy-error";
    output.textContent = "Could not copy. Open the Markdown to select it.";
  }
}

/** Links follow themselves and close the menu; a copy action stays open and says it copied. */
function choose({ menu, item }: { menu: PageMenu; item: HTMLElement }) {
  const value = item.dataset.docsMenuCopy;
  if (value === undefined) menu.popover.hidePopover();
  else void copyAction({ menu, item, value });
}

/** Swaps a copy action's title and icon for its copied ones, or back. */
function markCopied({ item, on }: { item: HTMLElement; on: boolean }) {
  const title = item.querySelector<HTMLElement>("[data-docs-menu-title][data-copied]");
  const [icon, check] = item.querySelectorAll<SVGElement>(".docs-menu-icon > svg");
  if (!title || !icon || !check) return;
  title.dataset.title ??= title.textContent ?? "";
  title.textContent = on ? (title.dataset.copied ?? "") : title.dataset.title;
  icon.style.display = on ? "none" : "";
  check.style.display = on ? "" : "none";
}

document.addEventListener("click", (event) => {
  const trigger =
    event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-docs-page-menu]")
      : null;
  if (!trigger) return;
  const menu = pageMenu({ trigger });
  if (!menu) return;
  if (menu.popover.matches(":popover-open")) menu.popover.hidePopover();
  /* A pointer click on the trigger of an open menu light-dismissed it on the way in. */
  else if (event.detail === 0 || performance.now() - menu.closedAt > 300)
    open({ menu, fromKeyboard: event.detail === 0 });
});
