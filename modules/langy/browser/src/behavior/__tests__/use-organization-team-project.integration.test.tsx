/**
 * The plan card and make-default ask read an organization grant from the organization scope,
 * never from the project: a project-only grant must not unlock them.
 * @vitest-environment jsdom
 */
import {
  UiCapabilityContextProvider,
  UiScope,
  type UiActiveScope,
  type UiCapabilities,
} from "@langwatch/browser-host/capabilities";
import { createUiCapabilitiesFromHost } from "@langwatch/browser-host/testing";
import {
  createUiScopeHost,
  type UiScopeHost,
} from "@langwatch/browser-host/use-organization-team-project";
import { cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LangyHostApi, LangyHostProvider, type LangyRouteReading } from "../../model/langy-host.ts";
import { useOrganizationTeamProject } from "../use-organization-team-project.ts";

class TestScope extends UiScope {
  constructor(private readonly host: UiScopeHost | undefined) {
    super();
  }
  activeScope(): UiActiveScope {
    return { organizationId: "org-1", projectId: "proj-1" };
  }
  scopeHost(): UiScopeHost | undefined {
    return this.host;
  }
}

/** Grants everything at project scope, so a project-bound check would read true. */
class ProjectGrantingLangyHost extends LangyHostApi {
  project() {
    return { id: "proj-1", slug: "demo", name: "demo" };
  }
  organization() {
    return { id: "org-1" };
  }
  team() {
    return { id: "team-1" };
  }
  organizationRole() {
    return "MEMBER";
  }
  currentUser() {
    return { id: "user-1" };
  }
  hasPermission() {
    return true;
  }
  isLoading() {
    return false;
  }
  isDemoProject() {
    return false;
  }
  featureFlag() {
    return false;
  }
  route(): LangyRouteReading {
    return { params: {}, query: {}, pathname: "/demo" };
  }
  setQuery() {}
  navigate() {}
  planManagementUrl() {
    return undefined;
  }
  succeeded() {}
  failed() {}
}

function readScope({ scopeHost }: { scopeHost: UiScopeHost | undefined }) {
  const capabilities: UiCapabilities = {
    ...createUiCapabilitiesFromHost({
      route: () => ({ params: {}, query: {}, pathname: "/demo" }),
      navigate: vi.fn(),
    }),
    scope: new TestScope(scopeHost),
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <UiCapabilityContextProvider value={capabilities}>
      <LangyHostProvider value={new ProjectGrantingLangyHost()}>{children}</LangyHostProvider>
    </UiCapabilityContextProvider>
  );
  return renderHook(() => useOrganizationTeamProject(), { wrapper }).result.current;
}

function scopeHostGranting({ organization }: { organization: string[] }) {
  return createUiScopeHost({
    project: () => ({ id: "proj-1", slug: "demo", name: "demo" }),
    organization: () => ({ id: "org-1" }),
    team: () => ({ id: "team-1" }),
    hasPermission: () => true,
    hasOrganizationPermission: (permission) => organization.includes(permission),
  });
}

afterEach(cleanup);

describe("useOrganizationTeamProject (langy)", () => {
  describe("given organization:manage granted only on the project", () => {
    it("refuses the organization permission", () => {
      const scope = readScope({ scopeHost: scopeHostGranting({ organization: [] }) });

      expect(scope.hasPermission("organization:manage")).toBe(true);
      expect(scope.hasOrgPermission("organization:manage")).toBe(false);
    });
  });

  describe("given organization:manage granted on the organization", () => {
    it("grants the organization permission", () => {
      const scope = readScope({
        scopeHost: scopeHostGranting({ organization: ["organization:manage"] }),
      });

      expect(scope.hasOrgPermission("organization:manage")).toBe(true);
    });
  });

  describe("given no scope host is mounted", () => {
    it("fails closed", () => {
      const scope = readScope({ scopeHost: void 0 });

      expect(scope.hasOrgPermission("organization:manage")).toBe(false);
    });
  });
});
