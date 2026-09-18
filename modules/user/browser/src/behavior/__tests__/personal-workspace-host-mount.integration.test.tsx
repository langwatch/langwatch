// @vitest-environment jsdom
/**
 * The SSO guard reads this port. Answering undefined left it permanently open.
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
const PROJECT_ID = "proj-1";

const ORGANIZATION_GRAPH = {
  id: ORGANIZATION_ID,
  name: "Local Dev Organization",
  slug: "local-dev-organization",
  members: [{ userId: "user-1", role: "ADMIN" }],
  ssoProvider: "okta",
  teams: [
    {
      id: "team-1",
      name: "Local Dev Team",
      projects: [{ id: PROJECT_ID, name: "Local Dev Project", slug: "local-dev-project" }],
    },
  ],
};

const answer = vi.fn(() => ({ data: [ORGANIZATION_GRAPH] }));
vi.mock("../personal-workspace-api.ts", () => ({
  personalWorkspaceApi: { organization: { getAll: { useQuery: () => answer() } } },
  api: { organization: { getAll: { useQuery: () => answer() } } },
}));

import { usePersonalWorkspaceHost } from "../../model/personal-workspace-host.ts";
import PersonalWorkspaceHostMount from "../personal-workspace-host-mount.tsx";

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
    },
  };

  return function Harness({ children }: { children: ReactNode }) {
    return (
      <UiCapabilityContextProvider value={capabilities}>
        <PersonalWorkspaceHostMount>{children}</PersonalWorkspaceHostMount>
      </UiCapabilityContextProvider>
    );
  };
}

/** Stands in for Settings > Authentication, which gates on the SSO provider. */
function GuardReader() {
  const host = usePersonalWorkspaceHost();
  const organization = host.organization();

  return (
    <div>
      <span data-testid="sso">{organization?.ssoProvider ?? "(none)"}</span>
      <span data-testid="team-of-project">{host.project()?.teamId ?? "(none)"}</span>
      <span data-testid="base-url">{host.deployment().appBaseUrl}</span>
    </div>
  );
}

describe("given a personal workspace host above the screens that read it", () => {
  describe("when the organization is pinned to a single sign-on provider", () => {
    /** @scenario "A mounted host answers the reading its screen renders from" */
    it("reports the provider, so the guard against a second way in can close", () => {
      const Harness = harness({ organizationId: ORGANIZATION_ID, projectId: PROJECT_ID });

      render(<GuardReader />, { wrapper: Harness });

      expect(screen.getByTestId("sso")).toHaveTextContent("okta");
      // The graph states a project's team by nesting; the port states it by field.
      expect(screen.getByTestId("team-of-project")).toHaveTextContent("team-1");
    });
  });

  describe("when the deployment names its own address", () => {
    it("passes that address through rather than an empty string", () => {
      const Harness = harness({ organizationId: ORGANIZATION_ID, projectId: PROJECT_ID });

      render(<GuardReader />, { wrapper: Harness });

      expect(screen.getByTestId("base-url")).toHaveTextContent("https://app.langwatch.test");
    });
  });
});
