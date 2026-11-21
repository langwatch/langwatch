// @vitest-environment jsdom
/**
 * The real analytics host answering grants in a project other than the page's, as the
 * Dashboards section in Gateway and Coding agents asks them.
 * @see modules/navigation/specs/product-sidebars.feature
 */
import {
  UiCopyTargets,
  UiHostServicesContextProvider,
  UiScope,
  UiSession,
  type UiActiveScope,
  type UiActor,
  type UiCopyTarget,
  type UiHostServices,
} from "@langwatch/browser-host/capabilities";
import type { UiSessionSnapshot } from "@langwatch/browser-host/session";
import { createUiHostServicesFromHost } from "@langwatch/browser-host/testing";
import { createUiQueryClient } from "@langwatch/browser/query-client";
import { answeringUiTransport, type UiProcedureCall } from "@langwatch/browser/testing-transport";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { analyticsHostInProject } from "../../model/analytics-host-in-project.ts";
import { useAnalyticsHost } from "../../model/analytics-host.ts";
import { analyticsApi } from "../analytics-api.ts";
import AnalyticsHostMount from "../analytics-host-mount.tsx";

const ADMIN: UiActor = { id: "user-admin", name: "Ada", email: null, image: null };
const PERSONAL = { id: "proj-mine", slug: "my-workspace", name: "My workspace" };
/** On a team the admin administers through the organization, with no membership row in it. */
const SHOP = { id: "proj-shop", slug: "shop", name: "Shop" };

/** The page's scope: the admin's own workspace, or no project at all, as on a Gateway page. */
class TestScope extends UiScope {
  constructor(private readonly projectId: string | null) {
    super();
  }

  activeScope(): UiActiveScope {
    return { organizationId: "org-1", projectId: this.projectId };
  }
}

/** The admin standing on their own workspace, as on /coding-agents. */
class AdminSession extends UiSession {
  currentUser(): UiActor {
    return ADMIN;
  }

  hasPermission(): boolean {
    return true;
  }

  isSettled(): boolean {
    return true;
  }

  override snapshot(): UiSessionSnapshot {
    return {
      session: { status: "authenticated", user: ADMIN },
      scope: {
        status: "ready",
        organization: { id: "org-1", name: "Acme" },
        team: undefined,
        project: PERSONAL,
      },
      permissions: {
        status: "ready",
        isLoading: false,
        can: () => true,
        canInOrganization: () => true,
      },
    };
  }
}

/** As organization lends them: only teams holding the reader's membership row, so never Shop. */
class MemberTeamsCopyTargets extends UiCopyTargets {
  targets(): readonly UiCopyTarget[] {
    return [
      {
        projectId: PERSONAL.id,
        projectSlug: PERSONAL.slug,
        label: "Acme / My workspace / My workspace",
        mayCreate: true,
      },
    ];
  }
}

/** The admin's own effective permissions per project, as `authz.effectivePermissions` reads. */
function standingIn(projectId: string | undefined) {
  if (projectId !== SHOP.id) return { scope: null, permissions: [], organizationPermissions: [] };
  return {
    scope: { type: "project", id: SHOP.id },
    permissions: ["analytics:view", "analytics:create", "analytics:update"],
    organizationPermissions: [],
  };
}

/** Answers every read; Shop's grants wait for `grantsHeld` when a test holds them back. */
function answering(grantsHeld: Promise<void>) {
  return ({ path, input }: UiProcedureCall): Promise<unknown> => {
    if (path === "project.getHasFirstMessage") return Promise.resolve({ firstMessage: true });
    if (path === "organization.getScopeGraph") return Promise.resolve([]);
    if (path === "authz.effectivePermissions") {
      const standing = standingIn((input as { projectId?: string }).projectId);
      return grantsHeld.then(() => standing);
    }
    return Promise.reject(new Error(`No test answer for ${path}`));
  };
}

/** Stands in for the section's grant check: one permission asked in one named project. */
function GrantInProject({ projectId, permission }: { projectId: string; permission: string }) {
  const granted = useAnalyticsHost().hasPermissionIn({ projectId, permission });
  return <span data-testid={permission}>{String(granted)}</span>;
}

/** The section's own settled answer, through the host it works through in Shop. */
function SettledInShop() {
  const inShop = analyticsHostInProject({ host: useAnalyticsHost(), project: SHOP });
  return <span data-testid="settled">{String(inShop.isSettled())}</span>;
}

/** The host's answers about the page's project and the one the shell registered. */
function PageProjects() {
  const host = useAnalyticsHost();
  return (
    <span data-testid="page-projects">
      {`${host.project()?.id ?? "none"} / ${host.registeredProjectId() ?? "none"}`}
    </span>
  );
}

function renderMount({
  children,
  pageProjectId = PERSONAL.id,
  grantsHeld = Promise.resolve(),
}: {
  children: ReactNode;
  pageProjectId?: string | null;
  grantsHeld?: Promise<void>;
}) {
  const services: UiHostServices = {
    ...createUiHostServicesFromHost(
      { route: () => ({ params: {}, query: {} }), navigate: () => void 0 },
      new AdminSession(),
    ),
    scope: new TestScope(pageProjectId),
    copyTargets: new MemberTeamsCopyTargets(),
  };
  const queryClient = createUiQueryClient({ onMutationError: () => void 0 });
  const client = answeringUiTransport(answering(grantsHeld));
  render(
    <UiHostServicesContextProvider value={services}>
      <analyticsApi.Provider client={client} queryClient={queryClient}>
        <AnalyticsHostMount>{children}</AnalyticsHostMount>
      </analyticsApi.Provider>
    </UiHostServicesContextProvider>,
  );
}

function renderInShop() {
  renderMount({
    children: (
      <>
        <GrantInProject projectId={SHOP.id} permission="analytics:create" />
        <GrantInProject projectId={SHOP.id} permission="analytics:delete" />
      </>
    ),
  });
}

afterEach(cleanup);

describe("given an organization admin with no membership row in Shop's team", () => {
  describe("when the section asks the real host for a grant in Shop", () => {
    /** @scenario "In Gateway or Coding agents, an organization admin's own grants in the named project count" */
    it("answers from the admin's own permissions in Shop, not the copy targets", async () => {
      renderInShop();

      await waitFor(() => expect(screen.getByTestId("analytics:create")).toHaveTextContent("true"));
      expect(screen.getByTestId("analytics:delete")).toHaveTextContent("false");
    });
  });

  describe("when the section works in Shop before Shop's grants land", () => {
    /** @scenario "In Gateway or Coding agents, what I may do follows the named project's grants" */
    it("is not settled until they land, then is", async () => {
      let releaseGrants = () => {};
      const grantsHeld = new Promise<void>((resolve) => {
        releaseGrants = resolve;
      });
      renderMount({ children: <SettledInShop />, grantsHeld });

      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getByTestId("settled")).toHaveTextContent("false");

      releaseGrants();
      await waitFor(() => expect(screen.getByTestId("settled")).toHaveTextContent("true"));
    });
  });
});

describe("given a page about no project, with the admin's workspace in the session", () => {
  describe("when a section asks which project the shell registered", () => {
    /** @scenario "Events from the Dashboards section in Gateway or Coding agents are about the named project" */
    it("answers the session's project, which the shell registers, though the page has none", () => {
      renderMount({ children: <PageProjects />, pageProjectId: null });

      expect(screen.getByTestId("page-projects")).toHaveTextContent(`none / ${PERSONAL.id}`);
    });
  });
});
