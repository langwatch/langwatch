/**
 * What the two evaluation addresses are actually behind, proved by mounting them — and what the application does with the overlay a screen asks for.
 * @vitest-environment jsdom
 * Spec: specs/evaluations/evaluation-pages.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { apiNode } = vi.hoisted(() => {
  const emptyQuery = { data: undefined, isLoading: false };
  const node = (): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (property === "useQuery") return () => emptyQuery;
          if (property === "useMutation") return () => ({ mutate: () => {}, isPending: false });
          if (property === "useUtils") return () => node();
          return node();
        },
      },
    );
  return { apiNode: node };
});

vi.mock("@langwatch/evaluator-web/screens/evaluators", async () => {
  const actual = await vi.importActual<
    typeof import("@langwatch/evaluator-web/screens/evaluators")
  >("@langwatch/evaluator-web/screens/evaluators");
  return {
    ...actual,
    evaluatorApi: apiNode(),
    evaluatorScreens: {
      evaluators: async () => ({ default: () => <div>the evaluators page</div> }),
    },
  };
});

vi.mock("@langwatch/monitor-web/screens/online-evaluations", async () => {
  const actual = await vi.importActual<
    typeof import("@langwatch/monitor-web/screens/online-evaluations")
  >("@langwatch/monitor-web/screens/online-evaluations");
  return {
    ...actual,
    monitorApi: apiNode(),
    monitorScreens: {
      onlineEvaluations: async () => ({ default: () => <div>the online evaluations page</div> }),
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
import { uiRouteTable, type UiRouteDescriptor } from "../src/model/ui-route-table";
import { evaluatorFeature } from "../src/features/evaluator";
import { overlayQuery as evaluatorOverlayQuery } from "../src/features/evaluator/behavior/evaluator-overlay-address";
import { monitorFeature } from "../src/features/monitor";
import { overlayQuery as monitorOverlayQuery } from "../src/features/monitor/behavior/monitor-open-overlay";
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

/** Every key this move serves, paired with the screen it must resolve to. */
const KEYS: ReadonlyArray<readonly [string, string]> = [
  ["pages/[project]/evaluators", "the evaluators page"],
  ["pages/[project]/online-evaluations", "the online evaluations page"],
];

async function openPage(key: string, permissions: readonly string[]): Promise<void> {
  const loader = { ...evaluatorFeature.loaders, ...monitorFeature.loaders }[key];
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

describe("given a reader who holds the evaluations view grant", () => {
  describe("when each evaluation address is opened", () => {
    /** @scenario "Reading the evaluator library needs the evaluations view grant" */
    /** @scenario "Reading the online evaluations needs the evaluations view grant" */
    it.each(KEYS)("%s opens its own screen", async (key, text) => {
      await openPage(key, ["evaluations:view"]);

      expect(screen.getByText(text)).toBeDefined();
    });
  });
});

describe("given a reader who holds no evaluations grant", () => {
  describe("when each evaluation address is opened directly", () => {
    /** @scenario "A reader without the evaluations view grant reaches no evaluator page" */
    /** @scenario "A reader without the evaluations view grant reaches no online evaluation page" */
    it.each(KEYS)("%s is refused and names the grant it needs", async (key, text) => {
      await openPage(key, ["traces:view"]);

      expect(screen.queryByText(text)).toBeNull();
      expect(screen.getByText(/evaluations:view/)).toBeDefined();
    });
  });
});

describe("given a screen that asks for an overlay this application owns", () => {
  describe("when the request is turned into an address", () => {
    /** @scenario "Creating an evaluator asks the application for the category picker" */
    it("names the drawer and prefixes each of its parameters", () => {
      expect(
        evaluatorOverlayQuery({
          drawer: "evaluatorEditor",
          params: { evaluatorId: "eval_1", evaluatorType: "langevals/answer_relevancy" },
        }),
      ).toEqual({
        "drawer.open": "evaluatorEditor",
        "drawer.evaluatorId": "eval_1",
        "drawer.evaluatorType": "langevals/answer_relevancy",
      });
    });

    /** @scenario "Editing any other monitor asks the application for the online evaluation drawer" */
    it("writes a bare open for an overlay that takes no parameters", () => {
      expect(monitorOverlayQuery({ drawer: "guardrails" })).toEqual({
        "drawer.open": "guardrails",
      });
      expect(
        monitorOverlayQuery({ drawer: "onlineEvaluation", params: { monitorId: "mon_1" } }),
      ).toEqual({ "drawer.open": "onlineEvaluation", "drawer.monitorId": "mon_1" });
    });
  });
});

describe("given the retired evaluation wizard address", () => {
  describe("when the route table is read", () => {
    /** @scenario "The retired evaluation wizard address forwards to the experiments workbench" */
    it("forwards to the experiments workbench and serves no page of its own", () => {
      const rows: UiRouteDescriptor[] = [];
      const visit = (descriptors: readonly UiRouteDescriptor[]): void => {
        for (const descriptor of descriptors) {
          rows.push(descriptor);
          if ("children" in descriptor && descriptor.children) visit(descriptor.children);
        }
      };
      visit(uiRouteTable);

      const wizard = rows.find((descriptor) => descriptor.path === "/:project/evaluations/wizard");

      expect(wizard).toBeDefined();
      expect(wizard && "redirect" in wizard ? wizard.redirect.to : void 0).toBe(
        "/:project/experiments/workbench",
      );
      // A page key here would mean the retired wizard still loads a module; the
      // whole point of the row is that it does not.
      expect(wizard && "page" in wizard).toBe(false);
    });
  });
});
