/**
 * @vitest-environment jsdom
 *
 * What the Agents address is actually behind, proved by mounting it.
 *
 * `ui-page-guard.unit.test.tsx` pins the guard's ordering; it would not notice a
 * loader that names the wrong grant — which is the failure that refuses a reader
 * the platform page admitted, or admits one it refused. So this file loads the
 * real loader, mounts what it hands back under a session that answers precisely,
 * and reads the result.
 *
 * The screen itself is faked, and so is the transport the host provider reads
 * the organization graph over. What is under test is the policy the frontend
 * feature wraps the screen in, and loading the whole page over a live tRPC
 * client to assert a refusal would test the screen instead.
 *
 * `evaluations:view` is the platform page's own grant, carried over one for one
 * from `withPermissionGuard("evaluations:view")`. It is not a flag: this family
 * released long ago and the platform page was behind none.
 *
 * Spec: specs/agents/agent-management.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/agent-web/screens/agent-management", async () => {
  const actual = await vi.importActual<
    typeof import("@langwatch/agent-web/screens/agent-management")
  >("@langwatch/agent-web/screens/agent-management");
  const Screen = () => <div>the agents page</div>;
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
    agentApi: apiNode(),
    agentScreens: { agentManagement: async () => ({ default: Screen }) },
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
import { agentPageLoaders } from "../src/features/agent";

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

const AGENTS_PAGE_KEY = "runtime/ui/features/agent-ui-host.adapter";

async function openPage(permissions: readonly string[]): Promise<void> {
  const loader = agentPageLoaders[AGENTS_PAGE_KEY];
  if (!loader) throw new Error(`no loader is registered for ${AGENTS_PAGE_KEY}`);
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

describe("given the agents page", () => {
  describe("when the reader holds the grant it asks for", () => {
    it("opens", async () => {
      await openPage(["evaluations:view"]);

      expect(screen.getByText(/the agents page/)).toBeDefined();
    });
  });

  describe("when the reader holds a neighbouring grant instead", () => {
    /** @scenario "The agents page is behind the grant its platform page asked for" */
    it("is refused, and named the grant it needs", async () => {
      await openPage(["triggers:view"]);

      expect(screen.queryByText(/the agents page/)).toBeNull();
      expect(screen.getByText(/evaluations:view/)).toBeDefined();
    });
  });

  describe("when the reader may manage agents but the page asks to view them", () => {
    it("is still refused, because manage does not imply view at this seam", async () => {
      // The hierarchy that makes `evaluations:manage` satisfy `evaluations:view`
      // is applied by the server when it answers the effective permission set,
      // not by the guard: the guard asks for a name and gets a yes or a no.
      await openPage(["evaluations:manage"]);

      expect(screen.queryByText(/the agents page/)).toBeNull();
    });
  });
});
