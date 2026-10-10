import { TeamSlugConflictError } from "@langwatch/organization-contract";
import { describe, expect, it } from "vitest";

import { MemoryOrganizationDatabase } from "../../repositories/memory/memory.organization.database.ts";
import { MemoryTeamRepository } from "../../repositories/memory/memory.team.repository.ts";
import { OrganizationTeamService } from "../organization-team.service.ts";
import { TeamIdentityService } from "../team-identity.service.ts";

const organizationId = "org_1";

async function setup() {
  const teams = MemoryTeamRepository.create({ memory: MemoryOrganizationDatabase.create() });
  const service = OrganizationTeamService.create({
    teams,
    authz: undefined as never,
    teamIdentities: TeamIdentityService.create(),
  });
  const platform = await service.createTeam({ organizationId, name: "Platform" });
  return { service, platform };
}

describe("team names are unique per organization", () => {
  /** @scenario "A team name is unique within its organization" */
  it("refuses creating a team with a taken name, ignoring case and padding", async () => {
    const { service } = await setup();

    const refusal = await service
      .createTeam({ organizationId, name: " platform " })
      .catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(TeamSlugConflictError);
    expect(refusal).toMatchObject({
      code: "team_name_taken",
      httpStatus: 409,
      message: "A team called platform already exists",
    });
  });

  it("refuses renaming another team to a taken name", async () => {
    const { service } = await setup();
    const data = await service.createTeam({ organizationId, name: "Data" });

    await expect(
      service.updateTeam({ organizationId, teamId: data.id, name: "PLATFORM" }),
    ).rejects.toMatchObject({ code: "team_name_taken" });
  });

  it("allows the same name in another organization", async () => {
    const { service } = await setup();

    await expect(
      service.createTeam({ organizationId: "org_2", name: "Platform" }),
    ).resolves.toMatchObject({ name: "Platform" });
  });

  /** @scenario A team keeps its own name when it is saved again */
  it("lets a team be renamed to its own name in another case", async () => {
    const { service, platform } = await setup();

    await expect(
      service.updateTeam({ organizationId, teamId: platform.id, name: "PLATFORM" }),
    ).resolves.toMatchObject({ name: "PLATFORM" });
  });
});
