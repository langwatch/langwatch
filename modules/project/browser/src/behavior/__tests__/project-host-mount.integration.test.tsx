// @vitest-environment jsdom
/**
 * Mounting a host is necessary, not sufficient: this mount was installed and
 * still answered undefined. Spec: specs/ui/module-host-mounting.feature
 */
import {
  UiCapabilityContextProvider,
  UiScope,
  type UiActiveScope,
  type UiCapabilities,
} from "@langwatch/browser-host/capabilities";
import { createUiCapabilitiesFromHost } from "@langwatch/browser-host/testing";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const ORGANIZATION_ID = "org-1";
const PROJECT_ID = "proj-1";

/** The one organization the read answers with, as the settings form needs it. */
const ORGANIZATION_GRAPH = {
  id: ORGANIZATION_ID,
  name: "Local Dev Organization",
  slug: "local-dev-organization",
  useCustomS3: false,
  s3Endpoint: null,
  s3AccessKeyId: null,
  s3SecretAccessKey: null,
  s3Bucket: null,
  presenceEnabled: true,
  traceSharingEnabled: false,
  supportContact: null,
  primaryIntent: null,
  teams: [
    {
      id: "team-1",
      name: "Local Dev Team",
      slug: "local-dev-team",
      isPersonal: false,
      projects: [
        {
          id: PROJECT_ID,
          name: "Local Dev Project",
          slug: "local-dev-project",
          language: "python",
          framework: "openai",
          userLinkTemplate: null,
          s3Endpoint: null,
          s3AccessKeyId: null,
          s3SecretAccessKey: null,
          s3Bucket: null,
          traceSharingEnabled: false,
          presenceEnabled: true,
          isPersonal: false,
          firstMessage: false,
        },
      ],
    },
  ],
};

// The module's own binding, answered in place: this test is about what the
// mount DOES with the graph, not about the wire that carries it.
const answer = vi.fn(() => ({ data: [ORGANIZATION_GRAPH] }));
vi.mock("../project-api.ts", () => ({
  api: { organization: { getAll: { useQuery: () => answer() } } },
}));

import { useProjectHost } from "../../model/project-host.ts";
import ProjectHostMount from "../project-host-mount.tsx";

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
  };

  return function Harness({ children }: { children: ReactNode }) {
    return (
      <UiCapabilityContextProvider value={capabilities}>
        <ProjectHostMount>{children}</ProjectHostMount>
      </UiCapabilityContextProvider>
    );
  };
}

/** Stands in for the settings screen: renders from the host, or renders nothing. */
function OrganizationReader() {
  const host = useProjectHost();
  const organization = host.organization();
  const project = host.project();

  if (!organization) return null;

  return (
    <div>
      <span data-testid="organization">{organization.name}</span>
      <span data-testid="team-count">{String(organization.teams.length)}</span>
      <span data-testid="project">{project?.name ?? "(none)"}</span>
    </div>
  );
}

describe("given a project host mounted above a screen that renders from it", () => {
  describe("when the organization graph has answered", () => {
    /** @scenario "A mounted host answers the reading its screen renders from" */
    it("renders the organization in scope rather than nothing", async () => {
      const Harness = harness({ organizationId: ORGANIZATION_ID, projectId: PROJECT_ID });

      render(<OrganizationReader />, { wrapper: Harness });

      await waitFor(() =>
        expect(screen.getByTestId("organization")).toHaveTextContent("Local Dev Organization"),
      );
      // The teams the LLMOps hand-off names a home from, and the project the
      // form edits: both travel through the same read.
      expect(screen.getByTestId("team-count")).toHaveTextContent("1");
      expect(screen.getByTestId("project")).toHaveTextContent("Local Dev Project");
    });
  });

  describe("when the address names no organization", () => {
    it("answers undefined, so the screen is free to say so", () => {
      const Harness = harness({ organizationId: null, projectId: null });

      render(<OrganizationReader />, { wrapper: Harness });

      expect(screen.queryByTestId("organization")).toBeNull();
    });
  });
});
