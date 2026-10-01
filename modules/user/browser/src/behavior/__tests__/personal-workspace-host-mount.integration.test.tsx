// @vitest-environment jsdom
/**
 * The SSO guard reads this port. Answering undefined left it permanently open.
 * Spec: specs/ui/module-host-mounting.feature
 */
import {
  UiCapabilityContextProvider,
  UiScope,
  UiSession,
  type UiActiveScope,
  type UiActor,
  type UiCapabilities,
} from "@langwatch/browser-host/capabilities";
import { createUiCapabilitiesFromHost } from "@langwatch/browser-host/testing";
import { fireEvent, render, screen } from "@testing-library/react";
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
  personalWorkspaceApi: { organization: { getScopeGraph: { useQuery: () => answer() } } },
  api: { organization: { getScopeGraph: { useQuery: () => answer() } } },
}));

import { usePersonalWorkspaceHost } from "../../model/personal-workspace-host.ts";
import PersonalWorkspaceHostMount from "../personal-workspace-host-mount.tsx";

class SignedInSession extends UiSession {
  refreshes = 0;

  override async refresh(): Promise<void> {
    this.refreshes += 1;
  }

  currentUser(): UiActor {
    return { id: "user-1", name: null, email: null, image: null };
  }

  hasPermission(): boolean {
    return false;
  }

  isSettled(): boolean {
    return true;
  }

  featureFlag(): boolean | undefined {
    return false;
  }
}

class TestScope extends UiScope {
  constructor(private readonly reading: UiActiveScope) {
    super();
  }

  activeScope(): UiActiveScope {
    return this.reading;
  }
}

function harness(scope: UiActiveScope, session = new SignedInSession()) {
  const capabilities: UiCapabilities = {
    ...createUiCapabilitiesFromHost(
      { route: () => ({ params: {}, query: {} }), navigate: () => void 0 },
      session,
    ),
    scope: new TestScope(scope),
    deployment: {
      isDevelopment: false,
      isSaaS: false,
      appBaseUrl: "https://app.langwatch.test",
      hasNlpService: true,
      hasLangevals: true,
      hasEmailProvider: false,
      emailPasswordEnabled: true,
      hasCloudOps: false,
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
      <span data-testid="passwords">{String(host.deployment().emailPasswordEnabled)}</span>
      <button onClick={() => void host.refreshSession()}>refresh</button>
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

  describe("when the deployment mounts email/password sign-in", () => {
    it("says so, so the password section shows beside single sign-on", () => {
      const Harness = harness({ organizationId: ORGANIZATION_ID, projectId: PROJECT_ID });

      render(<GuardReader />, { wrapper: Harness });

      expect(screen.getByTestId("passwords")).toHaveTextContent("true");
    });
  });

  describe("when a screen changed the reader's name or photo", () => {
    it("asks the shell's session to read the reader again", () => {
      const session = new SignedInSession();
      const Harness = harness({ organizationId: ORGANIZATION_ID, projectId: PROJECT_ID }, session);

      render(<GuardReader />, { wrapper: Harness });
      fireEvent.click(screen.getByRole("button", { name: "refresh" }));

      expect(session.refreshes).toBe(1);
    });
  });
});
