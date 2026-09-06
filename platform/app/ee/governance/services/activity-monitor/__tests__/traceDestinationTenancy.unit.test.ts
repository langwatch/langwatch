// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The write-time guard on a source's trace destination.
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 *
 * The picker only ever offers projects of the admin's own organization, but
 * the picker is not the boundary — the API is. A destination reaching
 * create/update by any other route (a crafted request, a stale drawer, a
 * script) has to be refused here, and refused by name so the admin knows
 * which field is wrong rather than being handed a generic failure.
 *
 * ADR-088 v7, Decision 9.
 */
import { describe, expect, it, vi } from "vitest";
import { IngestionSourceService } from "../ingestionSource.service";

type PrismaArg = ConstructorParameters<typeof IngestionSourceService>[0];

/** A prisma whose project lookup finds nothing — a foreign or archived id. */
function prismaFindingNoProject() {
  return {
    ingestionSource: {
      findUnique: vi.fn().mockResolvedValue({
        id: "src_1",
        organizationId: "org_acme",
        sourceType: "databricks_genie",
        name: "Genie fleet",
        parserConfig: {},
        pullSchedule: null,
        traceProjectId: null,
      }),
      create: vi.fn(),
      update: vi.fn(),
    },
    project: { findFirst: vi.fn().mockResolvedValue(null) },
  } as unknown as PrismaArg;
}

describe("given a trace destination outside the admin's organization", () => {
  describe("when it reaches update by any route other than the picker", () => {
    /** @scenario The picker cannot offer a project of another organization */
    it("is refused, and the destination is named as the reason", async () => {
      const prisma = prismaFindingNoProject();
      const service = IngestionSourceService.create(prisma);

      await expect(
        service.updateSource({
          id: "src_1",
          organizationId: "org_acme",
          traceProjectId: "proj_of_another_org",
        }),
      ).rejects.toThrow(/destination must be an active project/i);
    });

    /** @scenario The picker cannot offer a project of another organization */
    it("is refused before anything is written", async () => {
      const prisma = prismaFindingNoProject();
      const service = IngestionSourceService.create(prisma);

      await service
        .updateSource({
          id: "src_1",
          organizationId: "org_acme",
          traceProjectId: "proj_of_another_org",
        })
        .catch(() => undefined);

      const calls = (
        prisma as unknown as {
          ingestionSource: { update: ReturnType<typeof vi.fn> };
        }
      ).ingestionSource.update.mock.calls;
      expect(calls.length).toBe(0);
    });

    /** @scenario The picker cannot offer a project of another organization */
    it("is looked up scoped to the caller's own organization, not globally", async () => {
      const prisma = prismaFindingNoProject();
      const service = IngestionSourceService.create(prisma);

      await service
        .updateSource({
          id: "src_1",
          organizationId: "org_acme",
          traceProjectId: "proj_of_another_org",
        })
        .catch(() => undefined);

      const where = (
        prisma as unknown as {
          project: { findFirst: ReturnType<typeof vi.fn> };
        }
      ).project.findFirst.mock.calls[0]?.[0]?.where;
      expect(where).toMatchObject({
        id: "proj_of_another_org",
        archivedAt: null,
        team: { organizationId: "org_acme" },
      });
    });
  });
});

describe("given a destination on a team this admin is not a member of", () => {
  describe("when the drawer asks which destinations are still live", () => {
    /**
     * The drawer says an unresolvable destination is archived, and the spec
     * promises the reverse case is never mislabelled: a project the admin
     * simply cannot see is not gone. That promise rests entirely on this
     * query scoping liveness to the ORGANIZATION rather than to the reader's
     * team memberships — narrow it to the reader and every cross-team
     * destination starts reporting as archived, sending admins to restore
     * projects that were never archived.
     *
     * Deliberately carries no `@scenario` annotation: the scenario it
     * protects is bound at the drawer, where the behaviour is visible. This
     * is the server-side guard that keeps that binding honest, and it is
     * asserted with `toEqual` rather than `toMatchObject` on purpose — an
     * ADDED membership filter is exactly the regression, and `toMatchObject`
     * would wave it through.
     */
    it("scopes liveness to the organization, not to what this admin can see", async () => {
      const findMany = vi.fn().mockResolvedValue([{ id: "proj_other_team" }]);
      const prisma = {
        project: { findMany },
      } as unknown as PrismaArg;
      const service = IngestionSourceService.create(prisma);

      const live = await service.liveTraceProjectIds(
        [{ traceProjectId: "proj_other_team" }],
        "org_acme",
      );

      expect(live.has("proj_other_team")).toBe(true);
      expect(findMany.mock.calls[0]?.[0]?.where).toEqual({
        id: { in: ["proj_other_team"] },
        archivedAt: null,
        team: { organizationId: "org_acme" },
      });
    });
  });
});
