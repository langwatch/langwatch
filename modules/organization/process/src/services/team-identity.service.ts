import { newAuthzGrantId } from "@langwatch/authz-contract";
import { generate } from "@langwatch/ksuid";

import { organizationResourceSlug } from "../rules/organization-resource-slug.rules.ts";

export interface TeamIdentity {
  createTeam(input: { name: string }): {
    teamId: string;
    slug: string;
  };
  createBindingId(): string;
}

/** KSUID resource prefixes: a persisted format, since each id is written into a customer's row. */
const TEAM_KSUID_RESOURCE = "team";

/** The id's random tail the slug is told apart by; a KSUID's head is its timestamp. */
const TEAM_ID_SLUG_CHARS = 6;

/** New team ids are KSUIDs; ids minted before as `team_` + nanoid stay valid (Alex, 2026-09-27). */
export class TeamIdentityService implements TeamIdentity {
  static create(): TeamIdentityService {
    return new TeamIdentityService();
  }

  private constructor() {}

  createTeam(input: { name: string }): { teamId: string; slug: string } {
    const teamId = generate(TEAM_KSUID_RESOURCE).toString();

    return {
      teamId,
      slug: `${organizationResourceSlug(input.name)}-${teamId.slice(-TEAM_ID_SLUG_CHARS)}`,
    };
  }

  createBindingId(): string {
    return newAuthzGrantId();
  }
}
