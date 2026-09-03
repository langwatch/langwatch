/**
 * @vitest-environment jsdom
 *
 * The Langy host answers "is this the demo project" from the deployment's
 * own config leaf (`demoProjectSlug`) — the one fact a feature package may
 * not read itself (ADR-101). Every Langy surface downstream (the panel's
 * visibility gate, the project home hero, the command bar hand-off) reads
 * this one answer rather than comparing the slug again.
 *
 * Spec: specs/security/api-endpoint-authorization.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const DEMO_SLUG = "demo";

const graph = vi.hoisted(() => ({
  data: [] as Array<{
    id: string;
    teams: Array<{ projects: Array<{ id: string; slug: string; name: string }> }>;
  }>,
}));

vi.mock("@langwatch/langy-web/screens/langy-layout", async () => {
  const actual = await vi.importActual<typeof import("@langwatch/langy-web/screens/langy-layout")>(
    "@langwatch/langy-web/screens/langy-layout",
  );
  return {
    ...actual,
    langyApi: {
      organization: { getAll: { useQuery: () => ({ data: graph.data }) } },
    },
  };
});

vi.mock("../../../behavior/public-config", async () => {
  const actual = await vi.importActual<typeof import("../../../behavior/public-config")>(
    "../../../behavior/public-config",
  );
  return {
    ...actual,
    readPublicAppConfig: () => ({
      appBaseUrl: "https://app.example.com",
      gatewayBaseUrl: "https://gateway.example.com",
      deployment: "self-hosted",
      demoProjectSlug: DEMO_SLUG,
      mode: "test",
      telemetry: { browserTracing: false, sampleRatio: 0 },
      capabilities: { email: false, nlp: false, langevals: false },
      passkeys: false,
      identityFrontDoor: false,
    }),
  };
});

import { type LangyHostPort, useLangyHost } from "@langwatch/langy-web/screens/langy-layout";
import {
  UiCapabilityContextProvider,
  UiDocumentTitlePort,
  UiFeedbackPort,
  UiNavigationPort,
  UiRoutePort,
  UiSessionPort,
  type UiActiveScope,
  type UiActor,
  type UiCapabilities,
} from "../../../behavior/ui-capabilities";
import { withHost } from "../../../ui/sections/ui-page";
import { LangyHost } from "../ui/sections/host";

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
  succeeded(): void {}
  failed(): void {}
}

class SilentTitle extends UiDocumentTitlePort {
  set(): () => void {
    return () => {};
  }
}

/** Permission and rollout are wide open, so only the demo check can refuse. */
class OpenSession extends UiSessionPort {
  constructor(private readonly projectId: string) {
    super();
  }
  currentUser(): UiActor {
    return { id: "user-1", name: "Ana", email: null, image: null };
  }
  activeScope(): UiActiveScope {
    return { organizationId: "org_1", projectId: this.projectId };
  }
  hasPermission(): boolean {
    return true;
  }
  isSettled(): boolean {
    return true;
  }
  featureFlag(): boolean | undefined {
    return true;
  }
}

/** Mounts the real apps/ui composition and hands back the host it published. */
function mountHost(projectId: string): LangyHostPort {
  let published: LangyHostPort | undefined;
  const Reader = () => {
    published = useLangyHost();
    return null;
  };
  const Mounted = withHost(LangyHost, Reader);
  const capabilities: UiCapabilities = {
    documentTitle: new SilentTitle(),
    feedback: new SilentFeedback(),
    navigation: new SilentNavigation(),
    route: new SilentRoute(),
    session: new OpenSession(projectId),
  };
  render(
    <ChakraProvider value={defaultSystem}>
      <MemoryRouter>
        <UiCapabilityContextProvider value={capabilities}>
          <Mounted />
        </UiCapabilityContextProvider>
      </MemoryRouter>
    </ChakraProvider>,
  );
  if (!published) throw new Error("the provider published no host");
  return published;
}

beforeEach(() => {
  graph.data = [
    {
      id: "org_1",
      teams: [
        {
          projects: [
            { id: "proj_demo", slug: DEMO_SLUG, name: "Demo" },
            { id: "proj_acme", slug: "acme", name: "Acme" },
          ],
        },
      ],
    },
  ];
});
afterEach(cleanup);

describe("given the active project is the deployment's demo project", () => {
  describe("when any Langy surface asks the host", () => {
    /** @scenario "The demo project refuses Langy on every surface" */
    it("refuses Langy even with every permission and rollout flag granted", () => {
      const host = mountHost("proj_demo");

      expect(host.isDemoProject()).toBe(true);
    });
  });
});

describe("given the active project is an ordinary project", () => {
  describe("when the same host is asked", () => {
    it("does not refuse Langy", () => {
      const host = mountHost("proj_acme");

      expect(host.isDemoProject()).toBe(false);
    });
  });
});

describe("given no project has resolved yet", () => {
  describe("when the host is asked before a scope is picked", () => {
    it("does not read an unresolved project as a match", () => {
      const host = mountHost("proj_missing");

      expect(host.isDemoProject()).toBe(false);
    });
  });
});
