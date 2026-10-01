/**
 * @vitest-environment jsdom
 * The project home hands its onboarding snippets the deployment's address,
 * and gates Langy as main's useShowLangy did (team, grant, settled session).
 * Spec: specs/features/onboarding/setup-snippet-endpoint.feature
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

type Reading = {
  team: { id: string } | undefined;
  settled: boolean;
  granted: boolean;
  flag: boolean | undefined;
};

const reading = vi.hoisted((): Reading => ({
  team: void 0,
  settled: true,
  granted: true,
  flag: false,
}));

vi.mock("@langwatch/browser-host/capabilities", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  const session = {
    snapshot: () => ({
      scope: {
        status: "ready",
        organization: { id: "org-1", name: "Acme" },
        team: reading.team,
        project: { id: "project-1", name: "Shop", slug: "shop" },
      },
    }),
    currentUser: () => ({ id: "user-1", name: "Ada" }),
    hasPermission: () => reading.granted,
    isSettled: () => reading.settled,
    featureFlag: () => reading.flag,
  };
  const capabilities = {
    session,
    navigation: { navigate: vi.fn() },
    route: { reading: () => ({ params: {}, query: {} }) },
  };
  const deployment = {
    isSaaS: false,
    isDevelopment: false,
    appBaseUrl: "https://langwatch.acme.example",
  };
  return {
    ...original,
    useUiCapabilities: () => capabilities,
    useUiDeployment: () => deployment,
  };
});

vi.mock("../home-api.ts", () => ({
  homeApi: { organization: { getAll: { useQuery: () => ({ data: void 0 }) } } },
}));

vi.mock("../../model/langy/langy-demo-project.ts", () => ({ isLangyDemoProject: () => false }));

vi.mock("@langwatch/design-system/use-reduced-motion", () => ({ useReducedMotion: () => false }));

import {
  createUiScopeHost,
  UiScopeHostProvider,
} from "@langwatch/browser-host/use-organization-team-project";

import { useProjectHomeHost } from "../../model/project-home-host.ts";
import ProjectHomeHostMount from "../project-home-host-mount.tsx";

function BaseHost() {
  return <output aria-label="base host">{useProjectHomeHost().deployment().baseHost}</output>;
}

function LangyGate() {
  const { show, isResolving } = useProjectHomeHost().langyVisibility();
  if (isResolving) return <output aria-label="langy">resolving</output>;
  return <output aria-label="langy">{show ? "langy" : "classic"}</output>;
}

function renderGate({ organizationRole }: { organizationRole: string }) {
  const scope = createUiScopeHost({
    project: () => void 0,
    organization: () => void 0,
    team: () => reading.team,
    organizationRole: () => organizationRole,
    hasPermission: () => reading.granted,
  });
  render(
    <UiScopeHostProvider value={scope}>
      <ProjectHomeHostMount>
        <LangyGate />
      </ProjectHomeHostMount>
    </UiScopeHostProvider>,
  );
  return screen.getByLabelText("langy");
}

afterEach(() => {
  cleanup();
  Object.assign(reading, { team: void 0, settled: true, granted: true, flag: false });
});

describe("ProjectHomeHostMount", () => {
  describe("when the installation is reached on its own address", () => {
    /** @scenario "The project home's setup snippets use the deployment's address" */
    it("hands the onboarding snippets that address", () => {
      render(
        <ProjectHomeHostMount>
          <BaseHost />
        </ProjectHomeHostMount>,
      );

      expect(screen.getByLabelText("base host")).toHaveTextContent(
        "https://langwatch.acme.example",
      );
    });
  });
});

describe("ProjectHomeHostMount Langy gate", () => {
  describe("when an organization member holding langy:view is not on the project's team", () => {
    it("paints the classic home", () => {
      reading.flag = true;

      expect(renderGate({ organizationRole: "MEMBER" })).toHaveTextContent("classic");
    });
  });

  describe("when the reader is on the team and the rollout reveals Langy", () => {
    it("shows Langy", () => {
      Object.assign(reading, { team: { id: "team-1" }, flag: true });

      expect(renderGate({ organizationRole: "MEMBER" })).toHaveTextContent("langy");
    });
  });

  describe("when an organization admin is not on the team", () => {
    it("shows Langy, as main's admin rule does", () => {
      reading.flag = true;

      expect(renderGate({ organizationRole: "ADMIN" })).toHaveTextContent("langy");
    });
  });

  describe("when permissions are still loading", () => {
    it("reads as resolving rather than classic", () => {
      Object.assign(reading, { team: { id: "team-1" }, settled: false, granted: false });

      expect(renderGate({ organizationRole: "MEMBER" })).toHaveTextContent("resolving");
    });
  });

  describe("when the rollout flag is still in flight for a reader it could reveal Langy to", () => {
    it("reads as resolving", () => {
      Object.assign(reading, { team: { id: "team-1" }, flag: void 0 });

      expect(renderGate({ organizationRole: "MEMBER" })).toHaveTextContent("resolving");
    });
  });
});
