import { isColourLogo } from "../../../lib/logos.ts";
import { sitePath } from "../../../lib/site-path.ts";
import { QUICK_ACTION_GROUP, type SearchRow } from "../model/search-rows.ts";

const SVG = "http://www.w3.org/2000/svg";

/** A fresh copy of the first element in one of the page's prerendered search templates. */
export function fromTemplate({ id }: { id: string }): HTMLElement {
  const template = document.getElementById(id);
  const element =
    template instanceof HTMLTemplateElement
      ? template.content.firstElementChild?.cloneNode(true)
      : null;
  if (!(element instanceof Element)) throw new Error(`This page has no #${id} template`);
  return element as HTMLElement;
}

function fill({ item, part, text }: { item: Element; part: string; text: string }) {
  const node = item.querySelector(`[data-part="${part}"]`);
  if (!node) return;
  if (text) node.textContent = text;
  else node.remove();
}

/** The row's own icon, or null to keep the template's page glyph. */
function rowIcon({ row }: { row: SearchRow }): Element | null {
  if (row.heading) return fromTemplate({ id: "docs-search-icon-heading" });
  if (row.group === QUICK_ACTION_GROUP) return fromTemplate({ id: "docs-search-icon-link" });
  if (row.icon[0] === "/") {
    const chip = document.createElement("span");
    chip.className = "docs-command-logo";
    if (!isColourLogo({ icon: row.icon })) chip.dataset.chip = "";
    const image = document.createElement("img");
    image.src = sitePath({ path: row.icon });
    image.alt = "";
    chip.append(image);
    return chip;
  }
  if (!row.glyph) return null;
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "docs-command-glyph");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  /* The build's own icon markup, published in the search index beside the page. */
  svg.innerHTML = row.glyph;
  return svg;
}

/** One result: a link for a page or heading, a button for a quick action. */
export function rowElement({ row, position }: { row: SearchRow; position: number }) {
  const element = fromTemplate({ id: row.href ? "docs-search-page" : "docs-search-action" });
  element.id = `docs-command-${position}`;
  if (row.method) {
    element.dataset.method = row.method;
    element.className = "docs-command-operation";
  }
  const target = element.firstElementChild as HTMLElement;
  if (row.href) target.setAttribute("href", row.href);
  else target.dataset.searchAction = row.id;
  const item = element.querySelector<HTMLElement>("[data-index]");
  if (!item) return element;
  item.dataset.index = String(position);
  fill({ item, part: "label", text: row.title });
  fill({ item, part: "description", text: row.description });
  fill({ item, part: "meta", text: row.method });
  const icon = rowIcon({ row });
  if (icon) item.querySelector('[data-part="icon"]')?.replaceChildren(icon);
  return element;
}

/** The rows grouped under their section headings, in the order the rows are numbered. */
export function groupElements({ rows }: { rows: SearchRow[] }) {
  const groups = new Map<string, HTMLElement>();
  rows.forEach((row, position) => {
    let group = groups.get(row.group);
    if (!group) {
      group = fromTemplate({ id: "docs-search-group" });
      const label = group.firstElementChild;
      if (label) label.textContent = row.group;
      groups.set(row.group, group);
    }
    group.append(rowElement({ row, position }));
  });
  return [...groups.values()];
}
