/**
 * The shell mounted over auth's real session and organization's real scope, as
 * main.tsx composes them: a new actor holds nothing of the last one's.
 * @vitest-environment jsdom
 * Spec: specs/ui/shared-scope-host.feature
 */

import type { ModuleApiMap, RouterFromMap } from "@langwatch/api/web";
import type { UiAuthClient } from "@langwatch/auth-browser/session";
import { useUiCapabilities } from "@langwatch/browser-host/capabilities";
import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { createUiFeatureShell } from "@langwatch/browser/feature-shell";
import type { UiFeatureApiTransport } from "@langwatch/browser/transport";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import type { UiScopeOrganization, UiScopeTeam } from "@langwatch/organization-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, waitFor } from "@testing-library/react";
import { createTRPCUntypedClient, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { loadUiRootCapabilities } from "../ui-root-capabilities";

const root = await loadUiRootCapabilities();

const JANE = "user-jane";
const JOHN = "user-john";

const SHARED_TEAM: UiScopeTeam = {
  id: "team-shared",
  slug: "acme",
  isPersonal: false,
  ownerUserId: null,
  members: [{ userId: JANE }],
  projects: [{ id: "proj-app", slug: "acme-app", name: "ACME App" }],
};

const ACME: readonly UiScopeOrganization[] = [
  { id: "org-acme", slug: "acme", members: [{ role: "ADMIN" }], teams: [SHARED_TEAM] },
];

/** The deployment's grants procedure, as the session capability asks it. */
const PERMISSIONS_PROCEDURE = "authz.effectivePermissions";

/** Who the session endpoint says is signed in, until the test says otherwise. */
function sessionEndpoint(initial: string) {
  let current = initial;
  const client: UiAuthClient = {
    $fetch: () =>
      Promise.resolve({
        data: {
          user: { id: current, name: current, email: `${current}@example.com`, image: null },
        },
      }),
    signOut: () => {
      throw new Error("A session read ended the session.");
    },
  };
  return {
    client,
    signInAs: (next: string) => {
      current = next;
    },
  };
}

/** Answers every read for Jane; a read made once John is in waits for the test. */
function graphTransport(state: { actor: string }) {
  const link: TRPCLink<RouterFromMap<ModuleApiMap>> =
    () =>
    ({ op }) =>
      observable((observer) => {
        const answer = (data: unknown) => {
          observer.next({ result: { type: "data", data } });
          observer.complete();
        };
        if (state.actor === JOHN && op.path === root.organizationFacts.UI_ORGANIZATIONS_PROCEDURE) {
          return;
        }
        if (op.path === root.organizationFacts.UI_ORGANIZATIONS_PROCEDURE) answer(ACME);
        else if (op.path === PERMISSIONS_PROCEDURE) answer({ permissions: ["annotations:update"] });
        else answer({ enabled: false });
      });
  const transport: UiFeatureApiTransport = createTRPCUntypedClient({ links: [link] });
  return transport;
}

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = void 0;
  window.localStorage.clear();
});

function mountShell({
  authClient,
  transport,
}: {
  authClient: UiAuthClient;
  transport: UiFeatureApiTransport;
}) {
  const path = "/acme-app/traces";
  const Shell = createUiFeatureShell({
    sessionQueryKey: root.session.UI_SESSION_QUERY_KEY,
    apis: [],
    capabilities: {},
    transport,
    session: ({ transport: mounted, feedback }) => {
      const isPublicRoute = root.scope.isUiPublicRoute(path);
      const sessionReading = root.session.useUiSessionReading({
        feedback,
        isPublicRoute,
        authClient,
      });
      const scopeReading = root.scope.useUiScopeReading({
        transport: mounted,
        session: sessionReading,
      });
      const session = root.session.useBrowserUiSession({
        transport: mounted,
        session: sessionReading,
        scope: scopeReading.scope,
        isPublicRoute,
      });
      return {
        session,
        scope: root.scope.createBrowserUiScope({ reading: scopeReading, session }),
      };
    },
  });

  function Probe() {
    const { session } = useUiCapabilities();
    const { project, organization, hasPermission } = useOrganizationTeamProject();
    const userId = session.currentUser()?.id;
    const can = session.hasPermission("annotations:update");
    return (
      <div>
        <span data-testid="user">{userId ?? "nobody"}</span>
        <span data-testid="project">{project?.id ?? "none"}</span>
        <span data-testid="organization">{organization?.id ?? "none"}</span>
        <span data-testid="can">{String(can)}</span>
        <span data-testid="legacy-can">{String(hasPermission("annotations:update"))}</span>
      </div>
    );
  }

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      {
        path: "/:project/traces",
        element: (
          <QueryClientProvider client={queryClient}>
            <Shell>
              <Probe />
            </Shell>
          </QueryClientProvider>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  const view = renderWithDesignSystem(<RouterProvider router={router} />);
  dispose = () => {
    view.unmount();
    router.dispose();
  };
  return { view, queryClient };
}

describe("given the first user has resolved an organization and project grants", () => {
  describe("when the session switches to a different user whose organization query has not answered", () => {
    // Settled state only. The render between the new actor and the shell's reset still
    // publishes the old graph (handoff: behaviour question), so this is not bound yet.
    it("publishes neither the previous user's scope nor any grant of theirs", async () => {
      const endpoint = sessionEndpoint(JANE);
      const state = { actor: JANE };
      const { view, queryClient } = mountShell({
        authClient: endpoint.client,
        transport: graphTransport(state),
      });
      await waitFor(() => expect(view.getByTestId("project").textContent).toBe("proj-app"));
      await waitFor(() => expect(view.getByTestId("can").textContent).toBe("true"));
      expect(view.getByTestId("organization").textContent).toBe("org-acme");

      state.actor = JOHN;
      endpoint.signInAs(JOHN);
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: root.session.UI_SESSION_QUERY_KEY });
      });
      await waitFor(() => expect(view.getByTestId("user").textContent).toBe(JOHN));

      await waitFor(() => expect(view.getByTestId("project").textContent).toBe("none"));
      expect(view.getByTestId("organization").textContent).toBe("none");
      expect(view.getByTestId("can").textContent).toBe("false");
      expect(view.getByTestId("legacy-can").textContent).toBe("false");
    });
  });
});
