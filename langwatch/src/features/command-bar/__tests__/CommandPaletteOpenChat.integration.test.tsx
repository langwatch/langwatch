/**
 * @vitest-environment jsdom
 *
 * The palette's "Open Chat" action is a deliberate support-chat open, so it
 * must route through the Crisp bubble policy: the policy lifts the
 * suppression backstop before the widget is asked to show. A raw `$crisp`
 * push would leave the container hidden by the suppression CSS.
 * Spec: specs/support/crisp-bubble-suppression.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toggleSupportChatMock = vi.fn();

vi.mock("~/utils/crispBubblePolicy", () => ({
  toggleSupportChat: () => toggleSupportChatMock(),
}));
vi.mock("~/features/langy/hooks/useCanAskLangy", () => ({
  useCanAskLangy: () => true,
}));
vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: vi.fn() }),
}));
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project_1", slug: "demo" },
    organizations: [],
  }),
}));
// The support-chat command is only listed on SaaS, where Crisp boots.
vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: { IS_SAAS: true, NODE_ENV: "test" } }),
}));
vi.mock("~/hooks/useOpsPermission", () => ({
  useOpsPermission: () => ({ hasAccess: false }),
}));
vi.mock("~/hooks/useReducedMotion", () => ({
  useReducedMotion: () => true,
}));
vi.mock("~/utils/auth-client", () => ({
  useSession: () => ({ data: { user: { id: "user_1" } } }),
}));
vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    pathname: "/[project]",
    query: {},
    asPath: "/demo",
    push: vi.fn(async () => true),
  }),
}));
vi.mock("next-themes", () => ({
  useTheme: () => ({ setTheme: vi.fn() }),
}));
vi.mock("../useCommandSearch", () => ({
  useCommandSearch: () => ({
    idResult: null,
    searchResults: [],
    isLoading: false,
  }),
}));
vi.mock("../effects/useEasterEggEffects", () => ({
  useEasterEggEffects: () => ({ triggerEffect: vi.fn() }),
}));

import { CommandPalette } from "../CommandPalette";

function renderPalette({ query }: { query: string }) {
  const onDone = vi.fn();
  const view = render(
    <ChakraProvider value={defaultSystem}>
      <CommandPalette
        surface="dialog"
        active={true}
        query={query}
        setQuery={vi.fn()}
        onDone={onDone}
      />
    </ChakraProvider>,
  );
  return { ...view, onDone };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
});

describe("CommandPalette Open Chat routing", () => {
  describe("given the support chat command is listed", () => {
    describe("when the user selects Open Chat", () => {
      /** @scenario Opening chat from the command palette shows the widget */
      it("routes the open through the crisp bubble policy and closes the palette", () => {
        const crispPush = vi.fn();
        (window as unknown as { $crisp: { push: typeof crispPush } }).$crisp = {
          push: crispPush,
        };
        const { onDone } = renderPalette({ query: "Open Chat" });

        fireEvent.click(screen.getByText("Open Chat"));

        expect(toggleSupportChatMock).toHaveBeenCalledTimes(1);
        // The policy owns the crisp commands; the palette must not push any
        // itself, or the open would race the suppression backstop.
        expect(crispPush).not.toHaveBeenCalled();
        expect(onDone).toHaveBeenCalled();
      });
    });
  });
});
