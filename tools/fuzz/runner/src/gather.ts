import { z } from "zod";

import { candidateSchema } from "./picker.ts";

/**
 * GATHER_SOURCE runs in the page as plain source: a compiled function would carry the
 * bundler's helpers into the page, where they do not exist. It tags each usable control
 * with data-fuzz-id and reports them in DOM order.
 */
export const GATHER_SOURCE = String.raw`(() => {
  for (const tagged of document.querySelectorAll("[data-fuzz-id]")) tagged.removeAttribute("data-fuzz-id");
  const visible = (element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return box.width > 0 && box.height > 0 && style.visibility !== "hidden" &&
      style.display !== "none" && style.pointerEvents !== "none";
  };
  const overlay = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].find(visible);
  const root = overlay || document;
  const selector = 'a[href],button,[role="button"],[role="tab"],[role="menuitem"],[role="switch"],[role="checkbox"],[role="option"],summary,input,textarea,[contenteditable="true"]';
  const candidates = [];
  for (const element of root.querySelectorAll(selector)) {
    if (candidates.length >= 300 || !visible(element)) continue;
    if (element.disabled || element.getAttribute("aria-disabled") === "true") continue;
    const tag = element.tagName.toLowerCase();
    const inputType = tag === "input" ? element.type : undefined;
    const text = (element.getAttribute("aria-label") || element.innerText || element.value ||
      element.getAttribute("title") || element.placeholder || "").trim().replace(/\s+/g, " ").slice(0, 60);
    let kind = "button";
    let href;
    if (tag === "a") {
      const raw = element.getAttribute("href") || "";
      if (raw.startsWith("#") || raw.startsWith("javascript:") || raw.startsWith("mailto:")) continue;
      const target = new URL(raw, location.href);
      if (target.origin !== location.origin) continue;
      kind = "link";
      href = target.pathname + target.search;
    } else if (tag === "textarea" || element.getAttribute("contenteditable") === "true") {
      kind = "input";
    } else if (tag === "input") {
      if (["hidden", "file", "color"].includes(inputType)) continue;
      if (!["checkbox", "radio", "submit", "button", "reset", "image"].includes(inputType)) kind = "input";
    }
    if (kind === "button" && (/^(close|cancel|dismiss|×|✕|x)$/i.test(text) ||
        element.getAttribute("data-part") === "close-trigger")) kind = "close";
    const id = candidates.length;
    element.setAttribute("data-fuzz-id", String(id));
    candidates.push({ id, kind, tag, text, href, inputType });
  }
  return { overlayOpen: overlay !== undefined, candidates };
})()`;

const gatheredSchema = z.object({ overlayOpen: z.boolean(), candidates: z.array(candidateSchema) });
export type Gathered = z.infer<typeof gatheredSchema>;

/** parseGathered checks what the page returned against the schema the picker reads. */
export const parseGathered = (raw: unknown): Gathered => gatheredSchema.parse(raw);
