/**
 * What the four annotations addresses are actually behind, proved by mounting them — and which VIEW each of them is.
 * @vitest-environment jsdom
 * Spec: packages/features/annotation/specs/annotations-list-selection.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/annotation-web/screens/annotations", async () => {
  const actual = await vi.importActual<
    typeof import("@langwatch/annotation-web/screens/annotations")
  >("@langwatch/annotation-web/screens/annotations");
  const Screen = ({ view }: { view: string }) => <div>the annotations page: {view}</div>;
  const emptyQuery = { data: undefined, isLoading: false };
  const apiNode = (): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (property === "useQuery") return () => emptyQuery;
          if (property === "useMutation") return () => ({ mutate: () => {}, isPending: false });
          if (property === "useUtils") return () => apiNode();
          return apiNode();
        },
      },
    );
  return {
    ...actual,
    annotationApi: apiNode(),
    annotationScreens: {
      annotations: async () => ({ default: Screen }),
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
} from "@langwatch/ui-host/capabilities";
import { annotationFeature } from "../src/features/annotation";
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

const INBOX_KEY = "pages/[project]/annotations";
const MINE_KEY = "pages/[project]/annotations/me";
const ALL_KEY = "pages/[project]/annotations/all";
const WALKER_KEY = "pages/[project]/annotations/my-queue";
const QUEUE_KEY = "pages/[project]/annotations/[slug]";

async function openPage(key: string, permissions: readonly string[]): Promise<void> {
  const loader = annotationFeature.loaders[key];
  if (!loader) throw new Error(`no loader is registered for ${key}`);
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

describe("given the Inbox address", () => {
  describe("when the reader holds the grant it asks for", () => {
    it("opens on the Inbox view", async () => {
      await openPage(INBOX_KEY, ["annotations:view"]);

      expect(screen.getByText(/the annotations page: inbox/)).toBeDefined();
    });
  });

  describe("when the reader holds a neighbouring grant instead", () => {
    it("is refused, and named the grant it needs", async () => {
      await openPage(INBOX_KEY, ["traces:view"]);

      expect(screen.queryByText(/the annotations page/)).toBeNull();
      expect(screen.getByText(/annotations:view/)).toBeDefined();
    });
  });

  describe("when the reader may manage annotations but the page asks to view them", () => {
    it("is still refused, because manage does not imply view at this seam", async () => {
      // The hierarchy that makes `annotations:manage` satisfy `annotations:view`
      // is applied by the server when it answers the effective permission set,
      // not by the guard: the guard asks for a name and gets a yes or a no.
      await openPage(INBOX_KEY, ["annotations:manage"]);

      expect(screen.queryByText(/the annotations page/)).toBeNull();
    });
  });
});

describe("given the three addresses the platform pages left unguarded", () => {
  describe("when the reader holds no annotation grant at all", () => {
    it("opens the reviewer's own queue, because the platform page carried no guard", async () => {
      await openPage(MINE_KEY, []);

      expect(screen.getByText(/the annotations page: mine/)).toBeDefined();
    });

    it("opens All Annotations, for the same reason", async () => {
      await openPage(ALL_KEY, []);

      expect(screen.getByText(/the annotations page: all/)).toBeDefined();
    });

    it("opens a named queue, for the same reason", async () => {
      await openPage(QUEUE_KEY, []);

      expect(screen.getByText(/the annotations page: queue/)).toBeDefined();
    });
  });
});

describe("given the four keys map to four views", () => {
  describe("when each loader is resolved", () => {
    /**
     * The mapping is the only place that says which list an address is, and
     * getting it wrong shows a reader somebody else's work under their own
     * name. Every key is named here so a swapped pair cannot pass.
     */
    /** @scenario "Each annotations address opens its own list" */
    it.each([
      [INBOX_KEY, "inbox"],
      [MINE_KEY, "mine"],
      [ALL_KEY, "all"],
      [QUEUE_KEY, "queue"],
    ])("%s is the %s view", async (key, view) => {
      await openPage(key, ["annotations:view"]);

      expect(screen.getByText(`the annotations page: ${view}`)).toBeDefined();
    });

    /**
     * FIVE KEYS NOW, not four.
     */
    it("registers every annotations key, the queue walker included", () => {
      expect(Object.keys(annotationFeature.loaders).sort()).toEqual(
        [INBOX_KEY, QUEUE_KEY, ALL_KEY, MINE_KEY, WALKER_KEY].sort(),
      );
    });
  });
});
