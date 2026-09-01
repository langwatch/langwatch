/**
 * @vitest-environment jsdom
 *
 * What the two Datasets addresses are actually behind, proved by mounting them.
 *
 * `ui-page-guard.unit.test.tsx` pins the guard's ordering; it would not notice a
 * loader that names the wrong grant — which is the failure that refuses a reader
 * the platform page admitted, or admits one it refused. So this file loads the
 * real loaders, mounts what they hand back under a session that answers
 * precisely, and reads the result.
 *
 * The screens themselves are faked, and so is the transport the host provider
 * reads the organization graph over. What is under test is the policy the
 * frontend feature wraps each screen in, and loading a whole page over a live
 * tRPC client to assert a refusal would test the screen instead.
 *
 * THE TWO KEYS DIFFER, and that is the point of covering both: the list page was
 * `withPermissionGuard("datasets:view")` and the detail page was wrapped in no
 * guard at all — it read `hasPermission` only to decide whether to offer the Run
 * experiment button. A deep link into one dataset has always opened for anyone
 * who could reach the project.
 *
 * Spec: specs/datasets/datasets-list-page.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/dataset-web/screens/datasets", async () => {
  const actual = await vi.importActual<typeof import("@langwatch/dataset-web/screens/datasets")>(
    "@langwatch/dataset-web/screens/datasets",
  );
  const ListScreen = () => <div>the datasets page</div>;
  const EditorScreen = () => <div>the dataset editor page</div>;
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
    datasetApi: apiNode(),
    datasetScreens: {
      datasets: async () => ({ default: ListScreen }),
      datasetEditor: async () => ({ default: EditorScreen }),
    },
  };
});

vi.mock("../src/behavior/ui-organization-facts", () => ({
  useUiOrganizationFacts: () => ({
    isEnterprise: false,
    isPlanLoading: false,
    isLiteMember: false,
    isSaaS: false,
  }),
}));

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
import { datasetPageLoaders } from "../src/features/dataset";

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

const LIST_PAGE_KEY = "pages/[project]/datasets";
const EDITOR_PAGE_KEY = "pages/[project]/datasets/[id]";

async function openPage(key: string, permissions: readonly string[]): Promise<void> {
  const loader = datasetPageLoaders[key];
  if (!loader) throw new Error(`no loader is registered for ${key}`);
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

describe("given the datasets list page", () => {
  describe("when the reader holds the grant it asks for", () => {
    it("opens", async () => {
      await openPage(LIST_PAGE_KEY, ["datasets:view"]);

      expect(screen.getByText(/the datasets page/)).toBeDefined();
    });
  });

  describe("when the reader holds a neighbouring grant instead", () => {
    /** @scenario "The datasets page is behind the grant its platform page asked for" */
    it("is refused, and named the grant it needs", async () => {
      await openPage(LIST_PAGE_KEY, ["triggers:view"]);

      expect(screen.queryByText(/the datasets page/)).toBeNull();
      expect(screen.getByText(/datasets:view/)).toBeDefined();
    });
  });

  describe("when the reader may manage datasets but the page asks to view them", () => {
    it("is still refused, because manage does not imply view at this seam", async () => {
      // The hierarchy that makes `datasets:manage` satisfy `datasets:view` is
      // applied by the server when it answers the effective permission set, not
      // by the guard: the guard asks for a name and gets a yes or a no.
      await openPage(LIST_PAGE_KEY, ["datasets:manage"]);

      expect(screen.queryByText(/the datasets page/)).toBeNull();
    });
  });
});

describe("given one dataset's editor page", () => {
  describe("when the reader holds no dataset grant at all", () => {
    /** @scenario "One dataset's editor opens for anyone who can reach the project" */
    it("still opens, because the platform page carried no guard", async () => {
      await openPage(EDITOR_PAGE_KEY, []);

      expect(screen.getByText(/the dataset editor page/)).toBeDefined();
    });
  });
});
