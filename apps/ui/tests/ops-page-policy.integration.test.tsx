/**
 * @vitest-environment jsdom
 *
 * What each Ops address is actually behind, proved by mounting it.
 *
 * `ui-page-guard.unit.test.tsx` pins the guard's ordering; neither it nor a
 * routes test would notice a loader that names the wrong grant — which is the
 * failure that admits a reader the platform shell refused. That failure matters
 * more here than for any family before it: the Backoffice reads and writes every
 * tenant's rows, and `platform/app` gated it on a SEPARATE admin check
 * (`api.user.isAdmin`) precisely so that widening operator access could never
 * widen it. This file loads the real loaders, mounts what they hand back under a
 * session that answers precisely, and reads the result.
 *
 * The screens themselves are faked, and so is the transport the host provider
 * reads the organization graph over. What is under test is the policy the
 * frontend feature wraps a screen in, and loading thirteen thousand lines of
 * Chakra over a live tRPC client to assert a refusal would test the screen
 * instead.
 *
 * `ops:view` and `ops:manage` are the two platform-tier grants the authz
 * registry declares (`ops.actions = ["view", "manage"]`, `scopes:
 * ["platform"]`). They carry the platform shells' two policies one for one:
 * `OpsPageShell`'s live operator probe and `BackofficeShell`'s admin check.
 *
 * Spec: packages/features/ops/specs/admin.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/ops-web/screens/ops", async () => {
  const actual = await vi.importActual<typeof import("@langwatch/ops-web/screens/ops")>(
    "@langwatch/ops-web/screens/ops",
  );
  const screenNamed = (name: string) => async () => ({
    default: () => <div>the ops page: {name}</div>,
  });
  const backofficeScreen = async () => ({
    default: ({ resource }: { resource?: string }) => <div>the backoffice page: {resource}</div>,
  });
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
    opsApi: apiNode(),
    opsScreens: {
      dashboard: screenNamed("dashboard"),
      eventSourcing: screenNamed("event-sourcing"),
      deadLetters: screenNamed("dead-letters"),
      processes: screenNamed("processes"),
      projections: screenNamed("projections"),
      subscribers: screenNamed("subscribers"),
      schedules: screenNamed("schedules"),
      payloadStore: screenNamed("payload-store"),
      dejaView: screenNamed("deja-view"),
      featureFlags: screenNamed("feature-flags"),
      foundry: screenNamed("foundry"),
      migrations: screenNamed("migrations"),
      replayProgress: screenNamed("replay-progress"),
      backoffice: backofficeScreen,
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
import { opsPageLoaders } from "../src/features/ops";

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
    return null;
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

async function openPage(key: string, permissions: readonly string[]): Promise<void> {
  const loader = opsPageLoaders[key];
  if (!loader) throw new Error(`no loader is registered for ${key}`);
  const Mounted = (await loader()).default;
  // The refusal fallbacks are Chakra, so a refused page needs a system even
  // though the page it refuses never renders. The router is there because the
  // Ops host answers `asPath()` — the whole address including the fragment,
  // which Deja View keeps its workspace in — and only the router knows it.
  render(
    <MemoryRouter initialEntries={["/ops"]}>
      <ChakraProvider value={defaultSystem}>
        <UiCapabilityContextProvider value={capabilities(new AnsweringSession(permissions))}>
          <Mounted />
        </UiCapabilityContextProvider>
      </ChakraProvider>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe("given the Ops workspace", () => {
  describe("when an operator opens each of its pages", () => {
    it.each([
      ["pages/ops/index", "dashboard"],
      ["pages/ops/event-sourcing/index", "event-sourcing"],
      ["pages/ops/event-sourcing/dead-letters", "dead-letters"],
      ["pages/ops/event-sourcing/processes", "processes"],
      ["pages/ops/event-sourcing/projections", "projections"],
      ["pages/ops/event-sourcing/subscribers", "subscribers"],
      ["pages/ops/event-sourcing/schedules", "schedules"],
      ["pages/ops/blobs", "payload-store"],
      ["pages/ops/dejaview", "deja-view"],
      ["pages/ops/feature-flags", "feature-flags"],
      ["pages/ops/foundry", "foundry"],
      ["pages/ops/migrations", "migrations"],
      ["pages/ops/projections/[runId]", "replay-progress"],
      /** @scenario "An operator sees the Ops workspace" */
    ])("%s opens on the %s screen", async (key, name) => {
      await openPage(key, ["ops:view"]);

      expect(screen.getByText(`the ops page: ${name}`)).toBeDefined();
    });
  });

  describe("when the reader is not an operator", () => {
    /** @scenario "A reader without the operator grant is refused and told which grant" */
    it("is refused, and named the grant it needs", async () => {
      await openPage("pages/ops/index", ["analytics:view"]);

      expect(screen.queryByText(/the ops page/)).toBeNull();
      expect(screen.getByText(/ops:view/)).toBeDefined();
    });

    it("refuses every page of the workspace, not only the landing one", async () => {
      await openPage("pages/ops/event-sourcing/dead-letters", []);

      expect(screen.queryByText(/the ops page/)).toBeNull();
      expect(screen.getByText(/ops:view/)).toBeDefined();
    });
  });
});

describe("given the Backoffice, which reads every tenant's rows", () => {
  describe("when an admin opens each resource", () => {
    it.each([
      ["pages/ops/backoffice/users", "users"],
      ["pages/ops/backoffice/organizations", "organizations"],
      ["pages/ops/backoffice/projects", "projects"],
      ["pages/ops/backoffice/subscriptions", "subscriptions"],
      ["pages/ops/backoffice/sso-connections", "sso-connections"],
      ["pages/ops/backoffice/bug-reports", "bug-reports"],
    ])("%s opens on the %s resource", async (key, resource) => {
      await openPage(key, ["ops:manage"]);

      expect(screen.getByText(`the backoffice page: ${resource}`)).toBeDefined();
    });
  });

  /**
   * THE DECOUPLING, PROVED. `BackofficeShell`'s docblock asked for exactly this
   * — "if that scope ever broadens beyond admins, Backoffice stays strictly
   * admin-only" — and a page move that quietly collapsed the two checks into
   * one would have handed every operator the whole customer table.
   */
  describe("when an operator without the admin grant opens it", () => {
    it.each([
      "pages/ops/backoffice/users",
      "pages/ops/backoffice/organizations",
      "pages/ops/backoffice/subscriptions",
      "pages/ops/backoffice/sso-connections",
      /** @scenario "The Back office stays narrower than the workspace" */
    ])("refuses %s even though the workspace opens for them", async (key) => {
      await openPage(key, ["ops:view"]);

      expect(screen.queryByText(/the backoffice page/)).toBeNull();
      expect(screen.getByText(/ops:manage/)).toBeDefined();
    });
  });
});
