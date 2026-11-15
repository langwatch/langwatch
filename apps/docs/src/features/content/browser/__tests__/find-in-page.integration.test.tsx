// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  Object.defineProperty(document, "fonts", { value: { ready: Promise.resolve() } });
});

const ACCORDION = (open: boolean) =>
  `<div data-scope="accordion" data-part="item" data-state="closed">` +
  `<button data-scope="accordion" data-part="item-trigger" aria-expanded="false" aria-controls="a1">More</button>` +
  `<div data-scope="accordion" data-part="item-content" id="a1" data-state="closed" ${open ? "" : 'hidden="until-found"'}>Hidden words</div></div>`;

const TABS = (revealed: boolean) =>
  `<div data-scope="tabs" data-part="root"><div role="tablist">` +
  `<button role="tab" id="t0" aria-selected="true" data-selected aria-controls="p0">Python</button>` +
  `<button role="tab" id="t1" aria-selected="false" aria-controls="p1">curl</button></div>` +
  `<div role="tabpanel" id="p0" aria-labelledby="t0" data-docs-findable data-state="open">py</div>` +
  `<div role="tabpanel" id="p1" aria-labelledby="t1" data-docs-findable data-state="closed" ${revealed ? "" : 'hidden="until-found"'}>curl words</div></div>`;

const trigger = () =>
  document.querySelector('[data-part="item-trigger"]')?.getAttribute("aria-expanded");
const selectedTab = () => document.querySelector('[role="tab"][aria-selected="true"]')?.id;

/** What the browser does on a find-in-page match: `beforematch`, then it drops `hidden`. */
function reveal({ id }: { id: string }) {
  const panel = document.getElementById(id);
  panel?.dispatchEvent(new Event("beforematch", { bubbles: true }));
  panel?.removeAttribute("hidden");
}

describe("when find-in-page opens a hidden panel", () => {
  /** @scenario "A panel find-in-page opens shows as open" */
  it("marks panels opened before the scripts loaded, then follows later matches", async () => {
    document.body.innerHTML = ACCORDION(true) + TABS(true);
    await import("../disclosures.ts");
    await import("../tabs.ts");
    expect(trigger()).toBe("true");
    expect(selectedTab()).toBe("t1");

    document.body.innerHTML = ACCORDION(false) + TABS(false);
    reveal({ id: "a1" });
    reveal({ id: "p1" });
    await vi.waitFor(() => expect(trigger()).toBe("true"));
    expect(selectedTab()).toBe("t1");
  });
});
