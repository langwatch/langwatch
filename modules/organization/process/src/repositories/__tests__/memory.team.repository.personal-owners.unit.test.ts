import { type Instant, Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryOrganizationDatabase } from "../memory/memory.organization.database.ts";
import { MemoryTeamRepository } from "../memory/memory.team.repository.ts";

const ACME = "org_acme";
const OTHER = "org_other";
const EPOCH = Temporal.Instant.fromEpochMilliseconds(0);

function harness() {
  const memory = MemoryOrganizationDatabase.create();
  const team = (input: {
    id: string;
    organizationId: string;
    isPersonal: boolean;
    ownerUserId?: string | null;
    archivedAt?: Instant | null;
  }) =>
    memory.teams.set(input.id, {
      id: input.id,
      name: input.id,
      slug: input.id,
      organizationId: input.organizationId,
      isPersonal: input.isPersonal,
      ownerUserId: input.ownerUserId ?? null,
      archivedAt: input.archivedAt ?? null,
      createdAt: EPOCH,
      updatedAt: EPOCH,
    });
  return { team, repository: MemoryTeamRepository.create({ memory }) };
}

describe("MemoryTeamRepository.findPersonalTeamOwners", () => {
  describe("when the named teams include personal workspaces", () => {
    it("answers each personal team's owner, archived ones included", async () => {
      const { team, repository } = harness();
      team({ id: "team_mine", organizationId: ACME, isPersonal: true, ownerUserId: "user_1" });
      team({
        id: "team_old",
        organizationId: ACME,
        isPersonal: true,
        ownerUserId: "user_2",
        archivedAt: EPOCH,
      });
      team({ id: "team_shared", organizationId: ACME, isPersonal: false });

      const owners = await repository.findPersonalTeamOwners({
        organizationId: ACME,
        teamIds: ["team_mine", "team_old", "team_shared", "team_missing"],
      });

      expect(owners).toEqual([
        { teamId: "team_mine", ownerUserId: "user_1" },
        { teamId: "team_old", ownerUserId: "user_2" },
      ]);
    });
  });

  describe("when the personal team belongs to another organization", () => {
    it("answers nothing", async () => {
      const { team, repository } = harness();
      team({ id: "team_theirs", organizationId: OTHER, isPersonal: true, ownerUserId: "user_3" });

      expect(
        await repository.findPersonalTeamOwners({ organizationId: ACME, teamIds: ["team_theirs"] }),
      ).toEqual([]);
    });
  });
});
