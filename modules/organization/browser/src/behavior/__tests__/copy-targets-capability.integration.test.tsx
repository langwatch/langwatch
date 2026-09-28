/**
 * Organization's lent copy targets, graded per project over a fake transport.
 * Spec: specs/evaluations/evaluation-pages.feature
 * @vitest-environment jsdom
 */

import { createApiFixture } from "@langwatch/api-fixture";
import type { UiScopeOrganization } from "@langwatch/organization-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  createBrowserUiCopyTargets,
  UI_EFFECTIVE_PERMISSIONS_PROCEDURE,
  useUiCopyTargetsReading,
} from "../copy-targets-capability";
import type { UiFeatureApiTransport } from "../ui-scope-queries";

const GRAPH: readonly UiScopeOrganization[] = [
  {
    id: "org_1",
    name: "Acme",
    teams: [
      {
        id: "team_1",
        slug: "engineering",
        name: "Engineering",
        members: [{ userId: "user_1" }],
        projects: [
          { id: "proj_open", slug: "web-app", name: "Web App" },
          { id: "proj_closed", slug: "batch", name: "Batch" },
        ],
      },
      {
        id: "team_2",
        slug: "finance",
        name: "Finance",
        members: [{ userId: "someone_else" }],
        projects: [{ id: "proj_foreign", slug: "billing", name: "Billing" }],
      },
    ],
  },
];

/** Answers `authz.effectivePermissions` per project, as the server does for this reader. */
function grantingTransport(): { transport: UiFeatureApiTransport; asked: string[] } {
  const asked: string[] = [];
  const transport = createApiFixture<UiFeatureApiTransport>({
    query: (path: string, input: unknown) => {
      if (path !== UI_EFFECTIVE_PERMISSIONS_PROCEDURE) {
        return Promise.reject(new Error(`No test answer for ${path}`));
      }
      const projectId =
        typeof input === "object" && input !== null && "projectId" in input
          ? String(input.projectId)
          : "";
      asked.push(projectId);
      const permissions = projectId === "proj_open" ? ["evaluations:manage"] : ["evaluations:view"];
      return Promise.resolve({ scope: null, permissions });
    },
  });
  return { transport, asked };
}

function TargetsProbe({
  transport,
  organizations,
}: {
  transport: UiFeatureApiTransport;
  organizations: readonly UiScopeOrganization[] | undefined;
}) {
  const reading = useUiCopyTargetsReading({ transport, organizations, userId: "user_1" });
  const targets = createBrowserUiCopyTargets({ reading }).targets("evaluations:manage");
  if (!targets) return <p>no answer</p>;
  return (
    <ul>
      {targets.map((target) => (
        <li key={target.projectId}>
          {target.label}: {target.mayCreate ? "open" : "closed"}
        </li>
      ))}
    </ul>
  );
}

function renderProbe(organizations: readonly UiScopeOrganization[] | undefined) {
  const { transport, asked } = grantingTransport();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <TargetsProbe transport={transport} organizations={organizations} />
    </QueryClientProvider>,
  );
  return { asked };
}

afterEach(cleanup);

describe("given a reader who may manage evaluations in one of their projects and only view them in another", () => {
  describe("when the replicate dialog asks which projects they could replicate into", () => {
    /** @scenario "Each replication target is graded by my own permissions in that project" */
    it("lists both, open only where that project's own permissions grant it", async () => {
      const { asked } = renderProbe(GRAPH);

      expect(await screen.findByText("Acme / Engineering / Web App: open")).toBeTruthy();
      expect(screen.getByText("Acme / Engineering / Batch: closed")).toBeTruthy();
      expect(screen.queryByText(/Billing/)).toBeNull();
      expect(asked.toSorted()).toEqual(["proj_closed", "proj_open"]);
    });
  });

  describe("when the organization graph has not landed", () => {
    /** @scenario "Each replication target is graded by my own permissions in that project" */
    it("says it has no answer rather than an empty list", () => {
      renderProbe(void 0);

      expect(screen.getByText("no answer")).toBeTruthy();
    });
  });
});
