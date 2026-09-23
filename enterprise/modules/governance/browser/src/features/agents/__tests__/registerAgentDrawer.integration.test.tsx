/**
 * @vitest-environment jsdom
 * The register-agent drawer as `CurrentDrawer` mounts it. `AgentService.create` throws
 * `agent_register_only` (ADR-128), so it must show the snippet and assert that no fields exist.
 * `RenderCode` is mocked.
 * @see specs/ai-governance/dashboard/agents-page.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { findNativeSelects } from "../../../testing.tsx";

const harness = vi.hoisted(() => ({ closed: 0 }));

vi.mock("@langwatch/browser-host/drawer", () => ({
  useDrawer: () => ({
    openDrawer: vi.fn(),
    closeDrawer: () => {
      harness.closed += 1;
    },
    goBack: vi.fn(),
  }),
}));

vi.mock("@langwatch/browser-host/markdown", () => ({
  RenderCode: ({ code }: { code: string }) => <pre>{code}</pre>,
}));

import { RegisterAgentDrawer } from "../RegisterAgentDrawer";

function renderDrawer() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <RegisterAgentDrawer />
    </ChakraProvider>,
  );
}

beforeEach(() => {
  harness.closed = 0;
});
afterEach(cleanup);

describe("the register-agent drawer", () => {
  describe("when it opens", () => {
    /** @scenario "Register agent opens the connect-from-code drawer" */
    it("explains that the agent registers itself and shows both snippets", () => {
      renderDrawer();

      expect(screen.getByText(/An agent registers itself from the process/)).toBeVisible();
      expect(screen.getByText(/@langwatch.connect_agent/)).toBeVisible();
      expect(screen.getByText(/connectAgent\(/)).toBeVisible();
    });

    /** @scenario "Registering an agent collects nothing, because nothing could be saved" */
    it("offers no field and no submit", () => {
      renderDrawer();

      // Instructions, not a form: nothing here could be persisted, so nothing
      // is collected.
      expect(screen.queryAllByRole("textbox")).toHaveLength(0);
      expect(findNativeSelects(document.body)).toHaveLength(0);
      // And no footer submit. The sibling create drawer closes with a solid
      // orange Create; this one has nothing to create, so the only control it
      // carries is the way out.
      expect(
        screen.queryByRole("button", { name: /create|register|save|submit/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe("when the reader dismisses it", () => {
    /** @scenario "An address asking for the register drawer opens it on arrival" */
    it("closes through the drawer navigation rather than local state", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await user.click(screen.getByRole("button", { name: /close/i }));

      // Closing is a navigation: the address is what holds the drawer open,
      // so a drawer that closed itself locally would reopen on the next
      // render and leave `drawer.open` behind in the address.
      expect(harness.closed).toBe(1);
    });
  });
});
