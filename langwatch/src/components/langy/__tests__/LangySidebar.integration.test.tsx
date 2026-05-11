/**
 * @vitest-environment jsdom
 *
 * Binds langy-baseline.feature scenarios:
 *   - "Open Langy from the handle"
 *   - "Close Langy by clicking outside" (close via the handle is exercised
 *     here; outside-click semantics live one layer up in DashboardLayout
 *     and are deferred to a follow-up that renders the full layout)
 */
import { vi } from "vitest";

vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const streamWeb = require("node:stream/web") as {
    TransformStream: unknown;
    ReadableStream: unknown;
    WritableStream: unknown;
  };
  if (
    typeof (globalThis as { TransformStream?: unknown }).TransformStream ===
    "undefined"
  ) {
    Object.assign(globalThis, {
      TransformStream: streamWeb.TransformStream,
      ReadableStream:
        (globalThis as { ReadableStream?: unknown }).ReadableStream ??
        streamWeb.ReadableStream,
      WritableStream:
        (globalThis as { WritableStream?: unknown }).WritableStream ??
        streamWeb.WritableStream,
    });
  }
});

vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: [],
    sendMessage: vi.fn(),
    stop: vi.fn(),
    status: "ready",
  }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj_demo", slug: "demo" },
    organization: { id: "org_demo" },
    team: { id: "team_demo" },
  }),
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

vi.mock("~/components/Markdown", () => ({
  Markdown: ({ children }: { children: string }) => <div>{children}</div>,
}));

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { LangyDrawer } from "~/components/langy/LangySidebar";

function renderDrawer(props: Partial<Parameters<typeof LangyDrawer>[0]> = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <LangyDrawer {...props} />
    </ChakraProvider>,
  );
}

/**
 * Both the handle and the in-panel close icon use aria-label="Close Langy".
 * The handle renders first in DOM order (LangyDrawer composes <LangyHandle/>
 * before <LangyPanel/>), so getAllByRole(...)[0] is always the handle.
 */
function getHandle(label: RegExp): HTMLElement {
  const buttons = screen.getAllByRole("button", { name: label });
  return buttons[0]!;
}

afterEach(() => cleanup());

describe("LangyDrawer", () => {
  describe("given Langy is closed (uncontrolled, initial mount)", () => {
    describe("when the drawer renders", () => {
      it("shows the Langy handle with an 'Open Langy' affordance", () => {
        renderDrawer();
        expect(getHandle(/Open Langy/i)).toBeDefined();
      });
    });

    describe("when the user clicks the handle", () => {
      it("toggles the handle to the 'Close Langy' affordance", async () => {
        renderDrawer();
        await userEvent.click(getHandle(/Open Langy/i));
        expect(getHandle(/Close Langy/i)).toBeDefined();
      });
    });
  });

  describe("given controlled open state", () => {
    describe("when isOpen=false is provided by the parent", () => {
      it("renders the Open affordance on the handle", () => {
        renderDrawer({ isOpen: false });
        expect(getHandle(/Open Langy/i)).toBeDefined();
      });

      it("notifies the parent via onOpenChange(true) when the handle is clicked", async () => {
        const onOpenChange = vi.fn();
        renderDrawer({ isOpen: false, onOpenChange });
        await userEvent.click(getHandle(/Open Langy/i));
        expect(onOpenChange).toHaveBeenCalledWith(true);
      });
    });

    describe("when isOpen=true is provided by the parent", () => {
      it("renders the Close affordance on the handle", () => {
        renderDrawer({ isOpen: true });
        expect(getHandle(/Close Langy/i)).toBeDefined();
      });

      it("notifies the parent via onOpenChange(false) when the handle is clicked", async () => {
        const onOpenChange = vi.fn();
        renderDrawer({ isOpen: true, onOpenChange });
        await userEvent.click(getHandle(/Close Langy/i));
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });

      it("also notifies the parent when the in-panel close icon is clicked", async () => {
        const onOpenChange = vi.fn();
        renderDrawer({ isOpen: true, onOpenChange });
        const closeButtons = screen.getAllByRole("button", {
          name: /Close Langy/i,
        });
        // index 1 is the in-panel close (PanelHeader), since the handle
        // is index 0.
        expect(closeButtons.length).toBeGreaterThanOrEqual(2);
        await userEvent.click(closeButtons[1]!);
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
    });
  });
});
