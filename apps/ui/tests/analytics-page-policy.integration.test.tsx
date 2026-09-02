/**
 * @vitest-environment jsdom
 *
 * What the nine analytics addresses are actually behind, proved by mounting
 * them — and which SCREEN each of them is.
 *
 * `ui-page-guard.unit.test.tsx` pins the guard's ordering; it would not notice
 * a loader that names the wrong grant, which is the failure that refuses a
 * reader the platform page admitted or admits one it refused. Nor would it
 * notice a key mapped to the wrong screen, or the chart builder's two keys
 * handed the same mode — which is this family's own new failure: nine keys are
 * eight screens and the loader is the only place that says which.
 *
 * ALL NINE CARRY THE SAME GRANT, and that is the platform pages' policy one for
 * one: every one of the nine page files was
 * `withPermissionGuard("analytics:view")`. There is no asymmetry to carry here
 * and none to invent, unlike the annotations family — and asserting it in both
 * directions is what keeps a later "tidy-up" from quietly widening or narrowing
 * who can read a chart.
 *
 * The screens themselves are faked, and so is the transport the host provider
 * reads the organization graph over: what is under test is the policy and the
 * mapping the frontend feature wraps the screens in.
 *
 * Spec: specs/analytics/analytics-pages.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/analytics-web/screens/analytics", async () => {
  const actual = await vi.importActual<typeof import("@langwatch/analytics-web/screens/analytics")>(
    "@langwatch/analytics-web/screens/analytics",
  );
  const named = (name: string) => () => <div>the analytics page: {name}</div>;
  const builder = ({ mode }: { mode: string }) => (
    <div>the analytics page: custom-graph ({mode})</div>
  );
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
    analyticsApi: apiNode(),
    analyticsScreens: {
      overview: async () => ({ default: named("overview") }),
      users: async () => ({ default: named("users") }),
      topics: async () => ({ default: named("topics") }),
      metrics: async () => ({ default: named("metrics") }),
      evaluations: async () => ({ default: named("evaluations") }),
      reports: async () => ({ default: named("reports") }),
      query: async () => ({ default: named("query") }),
      customGraph: async () => ({ default: builder }),
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
import { analyticsPageLoaders } from "../src/features/analytics";

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

/** Every key this family serves, paired with the screen it must resolve to. */
const KEYS: ReadonlyArray<readonly [string, string]> = [
  ["pages/[project]/analytics/index", "overview"],
  ["pages/[project]/analytics/users", "users"],
  ["pages/[project]/analytics/topics", "topics"],
  ["pages/[project]/analytics/metrics", "metrics"],
  ["pages/[project]/analytics/evaluations", "evaluations"],
  ["pages/[project]/analytics/reports", "reports"],
  ["pages/[project]/analytics/query", "query"],
  ["pages/[project]/analytics/custom/index", "custom-graph (new)"],
  ["pages/[project]/analytics/custom/[id]", "custom-graph (edit)"],
];

async function openPage(key: string, permissions: readonly string[]): Promise<void> {
  const loader = analyticsPageLoaders[key];
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

describe("given a reader who holds the analytics grant", () => {
  describe("when each analytics address is opened", () => {
    /** @scenario "Every analytics address is behind the analytics view grant" */
    it.each(KEYS)("%s opens its own screen", async (key, screenName) => {
      await openPage(key, ["analytics:view"]);

      expect(screen.getByText(`the analytics page: ${screenName}`)).toBeDefined();
    });
  });
});

describe("given a reader who holds no analytics grant", () => {
  describe("when each analytics address is opened directly", () => {
    /** @scenario "A reader without the analytics grant reaches no analytics page" */
    it.each(KEYS)("%s is refused and names the grant it needs", async (key, screenName) => {
      await openPage(key, ["traces:view"]);

      expect(screen.queryByText(`the analytics page: ${screenName}`)).toBeNull();
      expect(screen.getByText(/analytics:view/)).toBeDefined();
    });
  });
});

describe("given the chart builder's two addresses", () => {
  describe("when each is opened", () => {
    /**
     * @scenario "The chart builder is told which of its two addresses it is"
     *
     * The two keys share one screen, and the MODE is the only thing that tells
     * a new chart from an editing one. Swapping the pair passes every other
     * assertion in this file — the screen resolves, the grant holds — and lands
     * a reader on a blank builder at the address of a saved chart.
     */
    /** @scenario "The chart builder is told which of its two addresses it is" */
    it("hands the create address the new mode and the edit address the edit mode", async () => {
      await openPage("pages/[project]/analytics/custom/index", ["analytics:view"]);
      expect(screen.getByText("the analytics page: custom-graph (new)")).toBeDefined();

      cleanup();
      await openPage("pages/[project]/analytics/custom/[id]", ["analytics:view"]);
      expect(screen.getByText("the analytics page: custom-graph (edit)")).toBeDefined();
    });
  });
});
