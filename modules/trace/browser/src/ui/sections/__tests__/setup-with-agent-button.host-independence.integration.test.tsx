/**
 * @vitest-environment jsdom
 * SetupWithAgentButton: shared by non-trace screens, uses host-optional hook.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SetupWithAgentButton } from "../setup-with-agent-button.tsx";

// Deliberately NOT mocked: "@langwatch/browser-host/use-organization-team-project".
// This test renders against the real hook, with no UiScopeHostProvider and no
// TraceHostProvider mounted, to prove the non-trace path stays safe.

const canAskMock = vi.fn(() => true);
vi.mock("../../../behavior/langy/use-can-ask-langy.ts", () => ({
  useCanAskLangy: () => canAskMock(),
}));

vi.mock("@langwatch/langy-browser-kit", () => ({
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
