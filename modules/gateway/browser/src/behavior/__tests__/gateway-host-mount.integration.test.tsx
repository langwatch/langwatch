// @vitest-environment jsdom
/**
 * The port answered an empty organization graph and a hard-coded plan.
 * Spec: specs/ui/module-host-mounting.feature
 */
import {
  UiCapabilityContextProvider,
  UiScope,
  UiSession,
  type UiActiveScope,
  type UiCapabilities,
} from "@langwatch/browser-host/capabilities";
import { createUiCapabilitiesFromHost } from "@langwatch/browser-host/testing";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const ORGANIZATION_ID = "org-1";

const ORGANIZATION_GRAPH = {
  id: ORGANIZATION_ID,
  name: "Local Dev Organization",
  slug: "local-dev-organization",
  teams: [
    {
      id: "team-1",
      name: "Local Dev Team",
      projects: [{ id: "proj-1", name: "Local Dev Project", slug: "local-dev-project" }],
    },
  ],
};

type UsageAnswer = {
  data?: { type: string; webhookEndpointsEnabled?: boolean };
  isLoading: boolean;
};

const answer = vi.fn(() => ({ data: [ORGANIZATION_GRAPH] }));
const usage = vi.fn((): UsageAnswer => ({ isLoading: false }));
vi.mock("../gateway-api.ts", () => ({
  gatewayApi: {
    organization: { getScopeGraph: { useQuery: () => answer() } },
    plan: { getActivePlan: { useQuery: () => usage() } },
  },
  api: { organization: { getScopeGraph: { useQuery: () => answer() } } },
}));

import { useGatewayHost } from "../../model/gateway-host.ts";
import GatewayHostMount from "../gateway-host-mount.tsx";

class TestScope extends UiScope {
  constructor(private readonly reading: UiActiveScope) {
    super();
  }

  activeScope(): UiActiveScope {
    return this.reading;
  }
}

class AdminSession extends UiSession {
  currentUser() {
    return null;
  }

  hasPermission(): boolean {
    return true;
  }

  isSettled(): boolean {
    return true;
  }

  featureFlag(): boolean | undefined {
    return false;
  }
}

function harness(scope: UiActiveScope, gatewayBaseUrl?: string) {
  const capabilities: UiCapabilities = {
    ...createUiCapabilitiesFromHost(
      { route: () => ({ params: {}, query: {} }), navigate: () => void 0 },
      new AdminSession(),
    ),
    scope: new TestScope(scope),
    deployment: {
      isDevelopment: false,
      isSaaS: false,
      appBaseUrl: "https://app.langwatch.test",
      hasNlpService: true,
      hasLangevals: true,
      hasEmailProvider: false,
      hasCloudOps: false,
      ...(gatewayBaseUrl ? { gatewayBaseUrl } : {}),
    },
  };

  return function Harness({ children }: { children: ReactNode }) {
    return (
      <UiCapabilityContextProvider value={capabilities}>
        <GatewayHostMount>{children}</GatewayHostMount>
      </UiCapabilityContextProvider>
    );
  };
}

/** Stands in for any gateway surface that names an organization or a team. */
function GraphReader() {
  const host = useGatewayHost();

  return (
    <div>
      <span data-testid="count">{String(host.organizations().length)}</span>
      <span data-testid="name">{host.organization()?.name ?? "(none)"}</span>
      <span data-testid="project-team">
        {host.organizations()[0]?.teams[0]?.projects[0]?.teamId ?? "(none)"}
      </span>
    </div>
  );
}

describe("given a gateway host above a surface that names an organization", () => {
  describe("when the organization graph has answered", () => {
    /** @scenario "A mounted host answers the reading its screen renders from" */
    it("reports the organizations rather than an empty list", () => {
      const Harness = harness({ organizationId: ORGANIZATION_ID, projectId: "proj-1" });

      render(<GraphReader />, { wrapper: Harness });

      expect(screen.getByTestId("count")).toHaveTextContent("1");
      expect(screen.getByTestId("name")).toHaveTextContent("Local Dev Organization");
      // The graph states a project's team by nesting; the port states it by field.
      expect(screen.getByTestId("project-team")).toHaveTextContent("team-1");
    });
  });
});

/** Stands in for the webhooks page, which branches on exactly this reading. */
function PlanReader() {
  const plan = useGatewayHost().plan();

  return (
    <div>
      <span data-testid="enterprise">{String(plan.isEnterprise)}</span>
      <span data-testid="webhooks">{String(plan.webhookEndpointsEnabled)}</span>
      <span data-testid="loading">{String(plan.isLoading)}</span>
    </div>
  );
}

describe("given a gateway host above a surface gated on the plan", () => {
  describe("when the organization's plan is Enterprise with webhook endpoints", () => {
    /** @scenario "A mounted host answers the reading its screen renders from" */
    it("reports the plan rather than a hard-coded refusal", () => {
      usage.mockReturnValue({
        data: { type: "ENTERPRISE", webhookEndpointsEnabled: true },
        isLoading: false,
      });

      render(<PlanReader />, {
        wrapper: harness({ organizationId: ORGANIZATION_ID, projectId: null }),
      });

      expect(screen.getByTestId("enterprise")).toHaveTextContent("true");
      expect(screen.getByTestId("webhooks")).toHaveTextContent("true");
      expect(screen.getByTestId("loading")).toHaveTextContent("false");
    });
  });

  describe("when a legacy plan row carries no webhook flag", () => {
    it("reads webhook endpoints as off", () => {
      usage.mockReturnValue({ data: { type: "ENTERPRISE" }, isLoading: false });

      render(<PlanReader />, {
        wrapper: harness({ organizationId: ORGANIZATION_ID, projectId: null }),
      });

      expect(screen.getByTestId("webhooks")).toHaveTextContent("false");
    });
  });

  describe("when the plan has not answered yet", () => {
    it("reports still-arriving rather than not entitled", () => {
      usage.mockReturnValue({ isLoading: true });

      render(<PlanReader />, {
        wrapper: harness({ organizationId: ORGANIZATION_ID, projectId: null }),
      });

      expect(screen.getByTestId("loading")).toHaveTextContent("true");
    });
  });
});

/** Stands in for the usage snippet, which prints the address a customer's SDK points at. */
function DeploymentReader() {
  const deployment = useGatewayHost().deployment();

  return (
    <div>
      <span data-testid="app">{deployment.appBaseUrl}</span>
      <span data-testid="gateway">{deployment.gatewayBaseUrl ?? "(none)"}</span>
    </div>
  );
}

describe("given a gateway host above a surface that prints the gateway address", () => {
  describe("when the deployment carries a gateway address", () => {
    /** @scenario "A mounted host answers the reading its screen renders from" */
    it("reports it beside the app address", () => {
      render(<DeploymentReader />, {
        wrapper: harness(
          { organizationId: ORGANIZATION_ID, projectId: null },
          "http://localhost:5563",
        ),
      });

      expect(screen.getByTestId("app")).toHaveTextContent("https://app.langwatch.test");
      expect(screen.getByTestId("gateway")).toHaveTextContent("http://localhost:5563");
    });
  });

  describe("when the deployment configures none", () => {
    it("reports absence rather than an empty address", () => {
      render(<DeploymentReader />, {
        wrapper: harness({ organizationId: ORGANIZATION_ID, projectId: null }),
      });

      expect(screen.getByTestId("gateway")).toHaveTextContent("(none)");
    });
  });
});
