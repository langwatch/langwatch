/**
 * @vitest-environment jsdom
 *
 * What the Prompt Studio address is actually behind, proved by mounting it.
 *
 * `ui-page-guard.unit.test.tsx` pins the guard's ordering; it would not notice a
 * loader that names the wrong grant — which is the failure that refuses a reader
 * the platform page admitted, or admits one it refused. So this file loads the
 * real loader, mounts what it hands back under a session that answers precisely,
 * and reads the result.
 *
 * The screen itself is faked, and so is the transport the host provider reads
 * the organization graph over. What is under test is the policy the frontend
 * feature wraps the screen in, and loading a whole studio over a live tRPC
 * client to assert a refusal would test the screen instead.
 *
 * ONE KEY, ONE GRANT: `platform/app`'s page was
 * `withPermissionGuard("prompts:view", { layoutComponent: DashboardLayout })`,
 * and only the grant travels.
 *
 * Spec: specs/prompts/prompt-studio-page.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/prompt-web/screens/prompt-studio", async () => {
  const actual = await vi.importActual<
    typeof import("@langwatch/prompt-web/screens/prompt-studio")
  >("@langwatch/prompt-web/screens/prompt-studio");
  const StudioScreen = () => <div>the prompt studio page</div>;
  const emptyQuery = { data: undefined, isLoading: false };
  const apiNode = (): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (property === "useQuery") return () => emptyQuery;
          if (property === "useMutation") return () => ({ mutate: () => {}, isPending: false });
          return apiNode();
        },
      },
    );
  return {
    ...actual,
    promptApi: apiNode(),
    promptScreens: {
      promptStudio: async () => ({ default: StudioScreen }),
    },
  };
});

import {
  BrowserUiDocumentTitle,
  UiCapabilityContextProvider,
  UiFeedbackPort,
  UiNavigationPort,
  UiRoutePort,
  UiSessionPort,
  type UiActiveScope,
  type UiActor,
  type UiCapabilities,
  type UiFailureNotice,
  type UiSuccessNotice,
} from "../src/behavior/ui-capabilities";
import { promptPageLoaders } from "../src/features/prompt";

class SilentNavigation extends UiNavigationPort {
  navigate(): void {}
  replace(): void {}
  back(): void {}
}

class SilentRoute extends UiRoutePort {
  reading() {
    return { params: {}, query: {} };
  }
  setQuery(): void {}
}

class SilentFeedback extends UiFeedbackPort {
  succeeded(_: UiSuccessNotice): void {}
  failed(_: UiFailureNotice): void {}
}

class AnsweringSession extends UiSessionPort {
  constructor(private readonly permissions: readonly string[]) {
    super();
  }

  currentUser(): UiActor | null {
    return { id: "user_1", name: null, email: null, image: null };
  }

  activeScope(): UiActiveScope {
    return { organizationId: "org_1", projectId: "proj_1" };
  }

  hasPermission(permission: string): boolean {
    return this.permissions.includes(permission);
  }

  isSettled(): boolean {
    return true;
  }

  featureFlag(): boolean | undefined {
    return true;
  }
}

function capabilities(session: UiSessionPort): UiCapabilities {
  return {
    documentTitle: BrowserUiDocumentTitle.create({ title: "" }),
    feedback: new SilentFeedback(),
    navigation: new SilentNavigation(),
    route: new SilentRoute(),
    session,
  };
}

const PROMPT_PAGE_KEY = "pages/[project]/prompts";

async function openPage(permissions: readonly string[]): Promise<void> {
  const loader = promptPageLoaders[PROMPT_PAGE_KEY];
  if (!loader) throw new Error(`no loader is registered for ${PROMPT_PAGE_KEY}`);
  const Mounted = (await loader()).default;
  // The refusal fallbacks are Chakra, so a refused page needs a system even
  // though the page it refuses never renders.
  render(
    <ChakraProvider value={defaultSystem}>
      <UiCapabilityContextProvider value={capabilities(new AnsweringSession(permissions))}>
        <Mounted />
      </UiCapabilityContextProvider>
    </ChakraProvider>,
  );
}

afterEach(cleanup);

describe("given the prompt studio page", () => {
  describe("when the reader holds the grant it asks for", () => {
    /** @scenario "Prompt Studio opens for a reader who may view prompts" */
    it("opens", async () => {
      await openPage(["prompts:view"]);

      expect(screen.getByText(/the prompt studio page/)).toBeDefined();
    });
  });

  describe("when the reader holds a neighbouring grant instead", () => {
    /** @scenario "Prompt Studio is behind the grant its platform page asked for" */
    it("is refused, and named the grant it needs", async () => {
      await openPage(["triggers:view"]);

      expect(screen.queryByText(/the prompt studio page/)).toBeNull();
      expect(screen.getByText(/prompts:view/)).toBeDefined();
    });
  });

  describe("when the reader holds every prompt grant except the read one", () => {
    /** @scenario "Prompt Studio is behind the grant its platform page asked for" */
    it("is still refused", async () => {
      // `prompts:create` and its siblings are real grants on the same resource,
      // and none of them is the one this page asks for. A loader that named the
      // resource rather than the action would let this through, and a loader
      // that named any prompt grant at all would too.
      await openPage(["prompts:create", "prompts:update", "prompts:delete"]);

      expect(screen.queryByText(/the prompt studio page/)).toBeNull();
    });
  });
});
