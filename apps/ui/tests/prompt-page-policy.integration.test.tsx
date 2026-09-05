/**
 * What the Prompt Studio address is actually behind, proved by mounting it.
 * @vitest-environment jsdom
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
} from "@langwatch/ui-host/capabilities";
import { promptFeature } from "../src/features/prompt";
import { MemoryRouter } from "react-router";

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
  const loader = promptFeature.loaders[PROMPT_PAGE_KEY];
  if (!loader) throw new Error(`no loader is registered for ${PROMPT_PAGE_KEY}`);
  const Mounted = (await loader()).default;
  // The refusal fallbacks are Chakra, so a refused page needs a system even
  // though the page it refuses never renders.
  render(
    <MemoryRouter>
      <ChakraProvider value={defaultSystem}>
        <UiCapabilityContextProvider value={capabilities(new AnsweringSession(permissions))}>
          <Mounted />
        </UiCapabilityContextProvider>
      </ChakraProvider>
    </MemoryRouter>,
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
