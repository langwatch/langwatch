import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import slugify from "slugify";
import {
  GroupIdentityPort,
  PersonalWorkspaceIdentityPort,
  TeamIdentityPort,
  type PersonalWorkspaceResourceIds,
} from "../ports/organization.port.ts";

/**
 * The identifiers and slugs organization resources are born with — a persisted format, not a
 * naming preference, since every value minted here is written into a row the customer owns
 * forever. The three ports share this module because they share the slug rule below.
 */
const TEAM_KSUID_RESOURCE = "team";
const PROJECT_KSUID_RESOURCE = "project";
const GROUP_KSUID_RESOURCE = "group";
const ROLE_BINDING_KSUID_RESOURCE = "rolebinding";

/** The personal slug's user-id prefix length, nanoid suffix length, and ingestion key length. */
const SLUG_USER_PREFIX_CHARS = 12;
const SLUG_SUFFIX_CHARS = 6;
const PERSONAL_PROJECT_API_KEY_CHARS = 40;

/** `team_` plus the first five nanoid characters — the team slug's distinguishing tail. */
const TEAM_ID_SLUG_CHARS = 11;

/**
 * The slug a shared team or an organization group is given. Separators (`:`, `?`, `&`, `_`)
 * become dashes before `slugify` sees them, since its character map would expand `&` to "and".
 */
function organizationResourceSlug(name: string): string {
  return slugify(name.replaceAll(/[:?&_]/g, "-"), {
    lower: true,
    strict: true,
    replacement: "-",
  });
}

function personalSlug(slugPrefix: string): string {
  return `personal-${slugPrefix}-${nanoid(SLUG_SUFFIX_CHARS).toLowerCase()}`;
}

export class PersonalWorkspaceIdentityAdapter extends PersonalWorkspaceIdentityPort {
  static create(): PersonalWorkspaceIdentityAdapter {
    return new PersonalWorkspaceIdentityAdapter();
  }

  private constructor() {
    super();
  }

  create(input: { userId: string; organizationId: string }): PersonalWorkspaceResourceIds {
    const slugPrefix = input.userId.toLowerCase().slice(0, SLUG_USER_PREFIX_CHARS);

    return {
      teamId: generate(TEAM_KSUID_RESOURCE).toString(),
      teamSlug: personalSlug(slugPrefix),
      projectId: generate(PROJECT_KSUID_RESOURCE).toString(),
      projectSlug: personalSlug(slugPrefix),
      projectApiKey: `pkey_${nanoid(PERSONAL_PROJECT_API_KEY_CHARS)}`,
      ownerBindingId: generate(ROLE_BINDING_KSUID_RESOURCE).toString(),
    };
  }
}

/**
 * A team id is deliberately not a KSUID: teams predate the scheme, carrying the `team_` + nanoid
 * shape instead. The binding minted alongside it is a KSUID, since bindings came after.
 */
export class TeamIdentityAdapter extends TeamIdentityPort {
  static create(): TeamIdentityAdapter {
    return new TeamIdentityAdapter();
  }

  private constructor() {
    super();
  }

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

/**
 * Unlike a team, a group's id is a KSUID and its slug carries no id tail — the organization
 * service appends its own disambiguating suffix when a base slug is already taken.
 */
export class GroupIdentityAdapter extends GroupIdentityPort {
  static create(): GroupIdentityAdapter {
    return new GroupIdentityAdapter();
  }

  private constructor() {
    super();
  }

  createGroupId(): string {
    return generate(GROUP_KSUID_RESOURCE).toString();
  }

  createBindingId(): string {
    return generate(ROLE_BINDING_KSUID_RESOURCE).toString();
  }

  slugify(name: string): string {
    return organizationResourceSlug(name);
  }
}
