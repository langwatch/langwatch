// @vitest-environment jsdom
/**
 * The port promised an organization graph and answered an empty array.
 * Spec: specs/ui/module-host-mounting.feature
 */
import {
  UiCapabilityContextProvider,
  UiScope,
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

const answer = vi.fn(() => ({ data: [ORGANIZATION_GRAPH] }));
vi.mock("../gateway-api.ts", () => ({
  gatewayApi: { organization: { getAll: { useQuery: () => answer() } } },
  api: { organization: { getAll: { useQuery: () => answer() } } },
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

function harness(scope: UiActiveScope) {
  const capabilities: UiCapabilities = {
    ...createUiCapabilitiesFromHost({
      route: () => ({ params: {}, query: {} }),
      navigate: () => void 0,
    }),
    scope: new TestScope(scope),
    deployment: {
      isDevelopment: false,
      isSaaS: false,
      appBaseUrl: "https://app.langwatch.test",
      hasNlpService: true,
      hasLangevals: true,
      hasEmailProvider: false,
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
