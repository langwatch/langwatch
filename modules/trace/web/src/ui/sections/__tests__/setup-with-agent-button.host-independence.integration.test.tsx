/**
 * Regression: `SetupWithAgentButton` is shared by screens that never mount a
 * `TraceHostProvider` (the project home page, scenario suites, simulations  - 
 * see `onboard-agent-pill.tsx`, `run-history-panel.tsx`,
 * `connected-agent-drawers.tsx`). It must read scope through the canonical,
 * host-optional `@langwatch/ui-host` hook rather than trace/web's own
 * `useOrganizationTeamProject`, which requires `useTraceHost` and throws
 * outside a trace screen.
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SetupWithAgentButton } from "../setup-with-agent-button.tsx";

// Deliberately NOT mocked: "@langwatch/ui-host/use-organization-team-project".
// This test renders against the real hook, with no UiScopeHostProvider and no
// TraceHostProvider mounted, to prove the non-trace path stays safe.

const canAskMock = vi.fn(() => true);
vi.mock("../../../behavior/langy/use-can-ask-langy.ts", () => ({
  useCanAskLangy: () => canAskMock(),
}));

vi.mock("@langwatch/langy-web/surfaces/langy-store", () => ({
  useLangyStore: (selector: (s: { askLangy: (p: string) => void }) => unknown) =>
    selector({ askLangy: vi.fn() }),
}));

vi.mock("@langwatch/design-system/toaster", () => ({
  toaster: { create: vi.fn() },
}));

vi.mock("../../../behavior/trace-api.ts", () => ({
  api: {
    setupSkills: {
      getPrompt: {
        useQuery: () => ({ data: undefined }),
      },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  canAskMock.mockReturnValue(true);
});

describe("given no TraceHostProvider or UiScopeHostProvider is mounted", () => {
  describe("when a non-trace screen renders SetupWithAgentButton", () => {
    /** @scenario A screen outside the trace module can render Setup via Agent */
    it("does not throw the TraceHostProvider mounting error", () => {
      expect(() =>
        render(
          <ChakraProvider value={defaultSystem}>
            <SetupWithAgentButton surface="traces" />
          </ChakraProvider>,
        ),
      ).not.toThrow();

      expect(screen.getByRole("button", { name: /setup via agent/i })).toBeDefined();
    });
  });
});
