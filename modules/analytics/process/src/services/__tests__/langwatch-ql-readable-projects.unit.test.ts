/**
 * The projects a card's editor offers a member: live ones the member holds `analytics:view` on.
 * @see modules/dashboard/specs/dashboards-v2.feature AC207
 * @vitest-environment node
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { LangWatchQLReadableProjectsService } from "../langwatch-ql-readable-projects.service.ts";

const NAMES = { a: "Alpha", b: "Beta", c: "Gamma" } as const;

function serviceFor({ live, readable }: { live: readonly string[]; readable: readonly string[] }) {
  return LangWatchQLReadableProjectsService.create({
    authz: createApiFixture<AuthzApi>({
      hasPermission: ({ projectId }) => Promise.resolve(readable.includes(projectId ?? "")),
    }),
    projects: createApiFixture<ProjectApi>({
      findOrganizationId: () => Promise.resolve("org-1"),
      findLiveNonGovernanceIdsByOrganization: () => Promise.resolve([...live]),
      listNamesByIds: ({ projectIds }) =>
        Promise.resolve(
          projectIds.map((id) => ({ id, name: NAMES[id as keyof typeof NAMES] })) as never,
        ),
    }),
  });
}

describe("given a member who reads Alpha and Beta, not Gamma, and an archived Delta", () => {
  /** @scenario "AC207 Project: the editor offers only the projects the member can read" */
  it("lists Alpha and Beta, never Gamma and never the archived one", async () => {
    const service = serviceFor({ live: ["a", "b", "c"], readable: ["a", "b", "d"] });

    expect(await service.listFor({ projectId: "a", userId: "user-1" })).toEqual([
      { id: "a", name: "Alpha" },
      { id: "b", name: "Beta" },
    ]);
  });

  it("lists nothing for a project that sits in no organization", async () => {
    const service = LangWatchQLReadableProjectsService.create({
      authz: createApiFixture<AuthzApi>({}),
      projects: createApiFixture<ProjectApi>({
        findOrganizationId: () => Promise.resolve(undefined),
      }),
    });

    expect(await service.listFor({ projectId: "x", userId: "user-1" })).toEqual([]);
  });
});
