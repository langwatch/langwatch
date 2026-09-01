/**
 * @vitest-environment jsdom
 *
 * What each gateway address is actually behind, proved by mounting it.
 *
 * `gateway-routes.unit.test.ts` pins which key each screen answers;
 * `ui-page-guard.unit.test.tsx` pins the guard's ordering. Neither would notice
 * a loader that names the wrong grant, or one that forgot the section flag —
 * which is the failure that opens an unreleased page or refuses a reader the
 * platform page admitted. So this file loads the real loaders, mounts what they
 * hand back under a session that answers precisely, and reads the result.
 *
 * The screens themselves are faked, and so is the transport the host provider
 * reads the organization graph over. What is under test is the policy the
 * frontend feature wraps a screen in, and loading six thousand lines of Chakra
 * over a live tRPC client to assert a refusal would test the screen instead.
 *
 * Spec: specs/ai-governance/rbac/delegated-governance-viewer.feature
 * (Routing policies opens on the grant its router asks for).
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/gateway-web/screens/gateway", async () => {
  const actual = await vi.importActual<typeof import("@langwatch/gateway-web/screens/gateway")>(
    "@langwatch/gateway-web/screens/gateway",
  );
  const Screen = () => <div>the gateway page</div>;
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
    gatewayApi: apiNode(),
    gatewayScreens: new Proxy({}, { get: () => async () => ({ default: Screen }) }),
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
import { gatewayPageLoaders } from "../src/features/gateway";

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
  constructor(
    private readonly answers: {
      flags: Record<string, boolean | undefined>;
      permissions: readonly string[];
    },
  ) {
    super();
  }

  currentUser(): UiActor | null {
    return null;
  }

  activeScope(): UiActiveScope {
    return { organizationId: "org_1", projectId: null };
  }

  hasPermission(permission: string): boolean {
    return this.answers.permissions.includes(permission);
  }

  isSettled(): boolean {
    return true;
  }

  featureFlag(flag: string): boolean | undefined {
    return this.answers.flags[flag];
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

async function openPage(
  key: string,
  answers: { flags?: Record<string, boolean | undefined>; permissions?: readonly string[] },
): Promise<void> {
  const loader = gatewayPageLoaders[key];
  if (!loader) throw new Error(`no loader is registered for ${key}`);
  const Mounted = (await loader()).default;
  const session = new AnsweringSession({
    flags: answers.flags ?? {},
    permissions: answers.permissions ?? [],
  });
  // The refusal fallbacks are Chakra, so a refused page needs a system even
  // though the page it refuses never renders.
  render(
    <ChakraProvider value={defaultSystem}>
      <UiCapabilityContextProvider value={capabilities(session)}>
        <Mounted />
      </UiCapabilityContextProvider>
    </ChakraProvider>,
  );
}

afterEach(cleanup);

describe("given the virtual keys page", () => {
  describe("when the reader holds the grant it asks for", () => {
    it("opens", async () => {
      await openPage("pages/gateway/virtual-keys", {
        permissions: ["virtualKeys:view"],
      });

      expect(screen.getByText("the gateway page")).toBeDefined();
    });
  });

  describe("when the reader holds a neighbouring grant instead", () => {
    it("is refused, and named the grant it needs", async () => {
      await openPage("pages/gateway/virtual-keys", {
        permissions: ["gatewayBudgets:view"],
      });

      expect(screen.queryByText("the gateway page")).toBeNull();
      expect(screen.getByText(/virtualKeys:view/)).toBeDefined();
    });
  });
});

describe("given the routing policies page", () => {
  const FLAG = "release_ui_ai_governance_enabled";

  describe("when the section flag is on and the reader may read policies", () => {
    /** @scenario "Routing policies opens on the grant its router asks for" */
    it("opens", async () => {
      await openPage("pages/gateway/routing-policies", {
        flags: { [FLAG]: true },
        permissions: ["routingPolicies:view"],
      });

      expect(screen.getByText("the gateway page")).toBeDefined();
    });
  });

  describe("when the section flag is off", () => {
    it("reads as a page that is not here, and never as a refusal", async () => {
      await openPage("pages/gateway/routing-policies", {
        flags: { [FLAG]: false },
        permissions: ["routingPolicies:view"],
      });

      expect(screen.queryByText("the gateway page")).toBeNull();
      expect(screen.getByText("This page is not here")).toBeDefined();
      expect(screen.queryByText(/routingPolicies:view/)).toBeNull();
    });
  });

  describe("when the flag is on but the reader may not read policies", () => {
    /** @scenario "Routing policies opens on the grant its router asks for" */
    it("is refused, and named the grant it needs", async () => {
      await openPage("pages/gateway/routing-policies", {
        flags: { [FLAG]: true },
        permissions: ["organization:view"],
      });

      expect(screen.queryByText("the gateway page")).toBeNull();
      expect(screen.getByText(/routingPolicies:view/)).toBeDefined();
    });
  });
});

describe("given the webhooks page", () => {
  describe("when the reader holds nothing in particular", () => {
    it("opens, because the platform page it moved from carried no view grant", async () => {
      await openPage("pages/gateway/webhooks", { permissions: [] });

      expect(screen.getByText("the gateway page")).toBeDefined();
    });
  });
});
