/**
 * @vitest-environment jsdom
 *
 * The register-agent drawer, mounted the way `CurrentDrawer` mounts it: on its
 * own, with the drawer navigation as its only boundary.
 *
 * What it has to prove is that it stayed instructions. `AgentService.create`
 * throws `agent_register_only` (ADR-128), so the drawer shows the snippet that
 * registers an agent and collects nothing — and a test that only checked the
 * snippet was present would pass just as happily on a drawer that had quietly
 * grown a name-and-environment form beside it, so the absence of fields is
 * asserted too.
 *
 * `RenderCode` is mocked to a plain block: the snippet under test is the string
 * the drawer passes it, and highlighting it through Shiki in jsdom buys
 * nothing.
 *
 * Spec: specs/ai-governance/dashboard/agents-page.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { findNativeSelects } from "~/components/governance/filters";

const harness = vi.hoisted(() => ({ closed: 0 }));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: vi.fn(),
    closeDrawer: () => {
      harness.closed += 1;
    },
    goBack: vi.fn(),
  }),
}));

vi.mock("~/components/code/RenderCode", () => ({
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

      expect(
        screen.getByText(/An agent registers itself from the process/),
      ).toBeVisible();
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
