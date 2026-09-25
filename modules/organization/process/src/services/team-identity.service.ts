import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";

import type { TeamIdentity } from "../app/organization.members.ts";
import { organizationResourceSlug } from "../rules/organization-resource-slug.rules.ts";

/** KSUID resource prefixes: a persisted format, since each id is written into a customer's row. */
const ROLE_BINDING_KSUID_RESOURCE = "rolebinding";

/** `team_` plus the first five nanoid characters — the team slug's distinguishing tail. */
const TEAM_ID_SLUG_CHARS = 11;

/**
 * A team id is deliberately not a KSUID: teams predate the scheme, carrying the `team_` + nanoid
 * shape instead. The binding minted alongside it is a KSUID, since bindings came after.
 */
export class TeamIdentityService implements TeamIdentity {
  static create(): TeamIdentityService {
    return new TeamIdentityService();
  }

  private constructor() {}

  createTeam(input: { name: string }): { teamId: string; slug: string } {
    const teamId = `team_${nanoid()}`;

    return {
      teamId,
      slug: `${organizationResourceSlug(input.name)}-${teamId.substring(0, TEAM_ID_SLUG_CHARS)}`,
    };
  }

  createBindingId(): string {
    return generate(ROLE_BINDING_KSUID_RESOURCE).toString();
  }
}
