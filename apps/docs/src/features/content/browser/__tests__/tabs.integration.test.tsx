// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { languageScript } from "../../../../site/document.ts";
import "../tabs.ts";

vi.hoisted(() => {
  Object.defineProperty(document, "fonts", { value: { ready: Promise.resolve() } });
});

let ids = 0;

/** A static tab group as the prerenderer emits it; `families` sets each tab's language. */
function group({ tabs }: { tabs: { label: string; family?: string }[] }) {
  const id = ++ids;
  const triggers = tabs
    .map(
      ({ label, family }, index) =>
        `<button role="tab" id="t${id}-${index}" aria-selected="${index === 0}" ${index === 0 ? "data-selected" : ""} ${family ? `data-docs-family="${family}"` : ""}>${label}</button>`,
    )
    .join("");
  const panels = tabs
    .map(
      ({ label }, index) =>
        `<div role="tabpanel" id="p${id}-${index}" aria-labelledby="t${id}-${index}" data-code-title="${label}.file" ${index === 0 ? "" : "hidden"}>${label}</div>`,
    )
    .join("");
  return `<div data-scope="tabs" data-part="root"><span data-docs-code-title>${tabs[0]?.label}.file</span><div role="tablist">${triggers}</div>${panels}</div>`;
}

/** Runs one of the page's inline scripts the way the parser would. */
function runInline({ script }: { script: string }) {
  const element = document.createElement("script");
  element.textContent = script.replace(/^<script>|<\/script>$/g, "");
  document.head.append(element);
  element.remove();
}

function selected() {
  return [...document.querySelectorAll('[data-scope="tabs"][data-part="root"]')].map(
    (root) => root.querySelector('[role="tab"][aria-selected="true"]')?.textContent,
  );
}

const PAGE = () =>
  group({
    tabs: [
      { label: "Python", family: "python" },
      { label: "TypeScript", family: "typescript" },
    ],
  }) +
  group({
    tabs: [
      { label: "Python SDK", family: "python" },
      { label: "TypeScript SDK", family: "typescript" },
      { label: "REST API" },
    ],
  }) +
  group({ tabs: [{ label: "Python (Notebook)" }, { label: "Environment variable" }] }) +
  group({
    tabs: [
      { label: "Go", family: "go" },
      { label: "Python", family: "python" },
    ],
  });

afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("when a reader picks a language in one tab group", () => {
  /** @scenario "Choose a language once and see it in every matching tab group" */
  it("selects that language in every group that offers it and remembers it", () => {
    document.body.innerHTML = PAGE();
    document.querySelectorAll<HTMLElement>('[role="tab"]')[1]?.click();
    expect(selected()).toEqual(["TypeScript", "TypeScript SDK", "Python (Notebook)", "Go"]);
    expect(localStorage.getItem("lw-docs:code-language")).toBe("typescript");
    const second = document.querySelectorAll('[data-scope="tabs"][data-part="root"]')[1];
    expect(second?.querySelector('[role="tabpanel"]:not([hidden])')?.textContent).toBe(
      "TypeScript SDK",
    );
  });

  /** @scenario "Choose a language once and see it in every matching tab group" */
  it("scrolls by the height the groups above gained, so the picked tab stays put", () => {
    document.body.innerHTML = PAGE();
    const scrollBy = vi.fn();
    vi.stubGlobal("scrollBy", scrollBy);
    const above = document.querySelectorAll<HTMLElement>('[role="tab"]')[1];
    const picked = document.querySelectorAll<HTMLElement>('[role="tab"]')[3];
    if (!above || !picked) throw new Error("fixture tabs are missing");
    /* The group above grows once it shows TypeScript, pushing the picked tab 60px down. */
    picked.getBoundingClientRect = () =>
      DOMRect.fromRect({ y: above.getAttribute("aria-selected") === "true" ? 460 : 400 });
    picked.click();
    expect(scrollBy).toHaveBeenCalledWith({ top: 60, behavior: "instant" });
    vi.unstubAllGlobals();
  });

  /** @scenario "Choose a language once and see it in every matching tab group" */
  it("carries the choice to the next page swapped in place", () => {
    document.body.innerHTML = PAGE();
    document.querySelectorAll<HTMLElement>('[role="tab"]')[0]?.click();
    document.body.innerHTML = PAGE();
    document.dispatchEvent(new Event("docs:navigated"));
    expect(selected()).toEqual(["Python", "Python SDK", "Python (Notebook)", "Python"]);
  });
});

describe("when a page with a remembered language is parsed", () => {
  /** @scenario "Show the remembered language before the page first paints" */
  it("selects it in every offering group, with its panel and filename, before any island runs", () => {
    localStorage.setItem("lw-docs:code-language", "typescript");
    document.body.innerHTML = PAGE();
    runInline({ script: languageScript });
    expect(selected()).toEqual(["TypeScript", "TypeScript SDK", "Python (Notebook)", "Go"]);
    const first = document.querySelector('[data-scope="tabs"][data-part="root"]');
    expect(first?.querySelector('[role="tabpanel"]:not([hidden])')?.textContent).toBe("TypeScript");
    expect(first?.querySelector("[data-docs-code-title]")?.textContent).toBe("TypeScript.file");
    expect(first?.querySelector('[role="tab"]')?.getAttribute("tabindex")).toBe("-1");
  });
});
