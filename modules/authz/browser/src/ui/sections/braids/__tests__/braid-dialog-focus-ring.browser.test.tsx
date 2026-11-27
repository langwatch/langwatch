/**
 * Real-Chromium layout of the braid dialog: jsdom lays nothing out, so only a browser can say the
 * condition field's focus ring stays inside every box that clips the dialog's columns.
 * @see modules/authz/specs/braids-screen.feature
 */

import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

vi.mock("@langwatch/trace-client", async () => ({
  traceClient: (await import("./braids-api-fake.ts")).braidTraces.traceClient,
}));
vi.mock("@monaco-editor/react", () => import("./monaco-editor-fake.tsx"));
vi.mock("../../../../behavior/authz-api.ts", async () => ({
  authzApi: (await import("./braids-api-fake.ts")).braidsFake.api,
}));

const { FakeAuthzHost, renderWithAuthzHost } = await import("../../../../testing.tsx");
const { default: BraidsScreen } = await import("../braids.screen.tsx");

afterEach(cleanup);

function openDialog() {
  const host = new FakeAuthzHost({
    scope: { organizationId: "org-1", projectId: "p-spec" },
    grants: new Set(["project:view", "braids:manage"]),
    plan: { isEnterprise: true, isLoading: false },
    query: { braid: "new" },
    structure: {
      organizationName: "Acme",
      teams: [{ id: "t-1", name: "Agents" }],
      projects: [
        { id: "p-orch", name: "orchestrator", teamId: "t-1", slug: "orchestrator-x1" },
        { id: "p-spec", name: "specialists", teamId: "t-1", slug: "specialists-x2" },
      ],
    },
  });
  renderWithAuthzHost(<BraidsScreen />, host);
}

/** The box drawing the field's focus ring: the nearest ancestor of the editor with an outline. */
function ringBox(editor: HTMLElement): HTMLElement {
  for (let node = editor.parentElement; node; node = node.parentElement) {
    if (getComputedStyle(node).outlineStyle !== "none") return node;
  }
  throw new Error("the condition field draws no focus ring");
}

/** Each box that clips the ring, as the side and how many pixels of the ring it cuts off. */
function clippedSides(ring: HTMLElement): string[] {
  const style = getComputedStyle(ring);
  const reach = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
  const box = ring.getBoundingClientRect();
  const cut: string[] = [];
  for (let node = ring.parentElement; node; node = node.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(node);
    if (overflowX === "visible" && overflowY === "visible") continue;
    const rect = node.getBoundingClientRect();
    const left = rect.left + node.clientLeft;
    const right = left + node.clientWidth;
    const top = rect.top + node.clientTop;
    const bottom = top + node.clientHeight;
    if (box.left - reach < left) cut.push(`left by ${left - (box.left - reach)}px`);
    if (box.right + reach > right) cut.push(`right by ${box.right + reach - right}px`);
    if (box.top - reach < top) cut.push(`top by ${top - (box.top - reach)}px`);
    if (box.bottom + reach > bottom) cut.push(`bottom by ${box.bottom + reach - bottom}px`);
  }
  return cut;
}

describe.each([
  { screenWidth: "wide", width: 1280 },
  { screenWidth: "narrow", width: 700 },
])("given a $screenWidth screen", ({ width }) => {
  /** @scenario The focused condition field shows its whole focus ring */
  it("keeps the focus ring of a refused condition inside the dialog", async () => {
    await page.viewport(width, 800);
    openDialog();
    const user = userEvent.setup();
    const editor = await screen.findByTestId("braid-condition");

    await user.click(editor);
    await user.paste('attributes[""]');
    await screen.findByTestId("braid-condition-check", {}, { timeout: 3000 });

    const ring = ringBox(editor);
    await expect.poll(() => parseFloat(getComputedStyle(ring).outlineWidth)).toBeGreaterThan(0);
    await expect.poll(() => clippedSides(ring)).toEqual([]);
  });
});
