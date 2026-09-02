/**
 * @vitest-environment jsdom
 *
 * What the four annotations addresses are actually behind, proved by mounting
 * them — and which VIEW each of them is.
 *
 * `ui-page-guard.unit.test.tsx` pins the guard's ordering; it would not notice a
 * loader that names the wrong grant, which is the failure that refuses a reader
 * the platform page admitted or admits one it refused. Nor would it notice a key
 * mapped to the wrong view, which is this family's own new failure: four keys
 * share one screen and the loader is the only place that says which list each
 * address is. Both are read here, off the real loaders.
 *
 * ONLY ONE OF THE FOUR KEYS CARRIES A GRANT, and the asymmetry is the platform
 * pages', carried rather than tidied. `annotations.tsx` was
 * `withPermissionGuard("annotations:view")`; `all.tsx`, `me.tsx` and
 * `[slug].tsx` were wrapped in nothing at all. Inventing a guard is a change to
 * who can reach a page, which a page move does not own — and it is not a hole:
 * every procedure behind all four keys carries `annotations:view` as its own
 * policy, so a reader without the grant meets a page whose reads all refused
 * rather than data they should not see. Asserted in both directions so that if
 * somebody does decide to state the grant on all four, this file is what makes
 * it a decision.
 *
 * The screen itself is faked, and so is the transport the host provider reads
 * the organization graph over: what is under test is the policy and the mapping
 * the frontend feature wraps the screen in.
 *
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
} from "../src/behavior/ui-capabilities";
import { annotationPageLoaders } from "../src/features/annotation";

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
const QUEUE_KEY = "pages/[project]/annotations/[slug]";

async function openPage(key: string, permissions: readonly string[]): Promise<void> {
  const loader = annotationPageLoaders[key];
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

    it("registers the four moved keys and leaves the queue walker to the host", () => {
      expect(Object.keys(annotationPageLoaders).sort()).toEqual(
        [INBOX_KEY, QUEUE_KEY, ALL_KEY, MINE_KEY].sort(),
      );
      expect(annotationPageLoaders["pages/[project]/annotations/my-queue"]).toBeUndefined();
    });
  });
});
