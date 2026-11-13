/**
 * @vitest-environment node
 * Spec: modules/trace/specs/trace-lookup-by-id.feature - an id that misses in the key's own
 * project is looked for in the organisation's other projects the key itself may read.
 */
import type { AuthzApi, AuthzCanBatchByIdsInput } from "@langwatch/authz-contract";
import type { ProjectApi, ProjectIdentity } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import type { TraceExistenceRepository } from "../../../../repositories/trace-existence.repository.ts";
import { TraceOtherProjectLookupService } from "../trace-other-project-lookup.service.ts";

const ORG = "org-1";
const OWN = "project-own";
const OTHER = "project-other";
const HIDDEN = "project-hidden";
const TRACE_ID = "63dc535cea6335c506bc81ef3543a07d";
const KEY_ID = "key-1";

function identity(id: string): ProjectIdentity {
  return {
    id,
    name: `Name of ${id}`,
    slug: `${id}-slug`,
    teamId: "team-1",
    organizationId: ORG,
    isPersonal: false,
    ownerUserId: null,
    kind: "standard",
  };
}

function makeService({
  holding,
  ownerReads,
  keyReads,
  projects = [OWN, OTHER, HIDDEN],
}: {
  holding: string[];
  ownerReads: string[];
  keyReads: string[];
  projects?: string[];
}) {
  const searchedFor: string[][] = [];
  const service = TraceOtherProjectLookupService.create({
    projects: createApiFixture<ProjectApi>(
      {
        getOrganizationId: async () => ORG,
        findLiveNonGovernanceIdsByOrganization: async () => projects,
        listNamesByIds: async ({ projectIds }) => projectIds.map(identity),
      },
      "projects",
    ),
    authz: createApiFixture<AuthzApi>(
      {
        canBatchByIds: async (input: AuthzCanBatchByIdsInput) => {
          const reads = input.principal.type === "apiKey" ? keyReads : ownerReads;
          return {
            teams: new Map(),
            projects: new Map(
              input.projects.map((p) => [p.projectId, reads.includes(p.projectId)]),
            ),
            organizationRole: null,
          };
        },
      },
      "authz",
    ),
    existence: createApiFixture<TraceExistenceRepository>(
      {
        findProjectsHoldingTrace: async ({ projectIds }) => {
          searchedFor.push([...projectIds]);
          return projectIds.filter((id) => holding.includes(id));
        },
      },
      "existence",
    ),
  });
  return { service, searchedFor };
}

const principal = { type: "apiKey" as const, id: KEY_ID };

describe("TraceOtherProjectLookupService", () => {
  describe("given the trace is in another project the key may read", () => {
    /** @scenario A trace in another project the key may read is served from that project */
    it("answers that project as readable by the key", async () => {
      const { service } = makeService({ holding: [OTHER], ownerReads: [OTHER], keyReads: [OTHER] });

      const result = await service.locate({ projectId: OWN, traceId: TRACE_ID, principal });

      expect(result.located).toEqual({ project: identity(OTHER) });
    });
  });

  describe("given the trace is in a project only the key's owner may read", () => {
    /** @scenario A trace in a project the key may not read stays hidden */
    it("never searches or names that project", async () => {
      const { service, searchedFor } = makeService({
        holding: [HIDDEN],
        ownerReads: [OTHER, HIDDEN],
        keyReads: [OTHER],
      });

      const result = await service.locate({ projectId: OWN, traceId: TRACE_ID, principal });

      expect(result.located).toBeUndefined();
      expect(searchedFor).toEqual([[OTHER]]);
      expect(result.searchedProjectSlugs).toEqual([`${OTHER}-slug`]);
      expect(JSON.stringify(result)).not.toContain(HIDDEN);
    });
  });

  describe("given more unreadable projects than the search cap ahead of a readable one", () => {
    /** @scenario A trace in another project the key may read is served from that project */
    it("still searches the readable project", async () => {
      const unreadable = Array.from({ length: 150 }, (_, i) => `project-unreadable-${i}`);
      const { service, searchedFor } = makeService({
        holding: [OTHER],
        ownerReads: [OTHER],
        keyReads: [OTHER],
        projects: [OWN, ...unreadable, OTHER],
      });

      const result = await service.locate({ projectId: OWN, traceId: TRACE_ID, principal });

      expect(result.located).toEqual({ project: identity(OTHER) });
      expect(searchedFor).toEqual([[OTHER]]);
    });
  });

  describe("given a request with no principal", () => {
    it("searches nothing", async () => {
      const { service, searchedFor } = makeService({
        holding: [OTHER],
        ownerReads: [OTHER],
        keyReads: [OTHER],
      });

      const result = await service.locate({ projectId: OWN, traceId: TRACE_ID, principal: null });

      expect(result.located).toBeUndefined();
      expect(searchedFor).toEqual([]);
    });
  });
});
