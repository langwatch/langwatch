import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import slugify from "slugify";
import {
  GroupIdentityPort,
  PersonalWorkspaceIdentityPort,
  TeamIdentityPort,
  type PersonalWorkspaceResourceIds,
} from "../ports/organization.port";

/**
 * The identifiers and slugs organization resources are born with.
 *
 * Every value minted here is written into a row the customer then owns
 * forever — a team, a group, a project, that project's ingestion key, the
 * bindings that grant access to them — so each shape below is a PERSISTED
 * FORMAT rather than a naming preference. They lived in the platform
 * application's composition root, which meant a second process could reach
 * these operations only by describing every format again; two descriptions of
 * an id format is how a workspace ends up with a project slug the URL router
 * does not recognise, or a binding the revocation queries never find.
 *
 * The three ports share this module because they share the slug rule below.
 * Splitting them into three files put that rule in two of them, and a second
 * copy is how a group starts spelling an accent differently from a team.
 *
 * The KSUID resource prefixes are spelled as literals, the way every other
 * feature package spells its own. They are the same ones the platform
 * application's `KSUID_RESOURCES` names, and they cannot drift silently: a
 * changed prefix produces ids the existing rows do not match, which this
 * module's suite pins.
 */
const TEAM_KSUID_RESOURCE = "team";
const PROJECT_KSUID_RESOURCE = "project";
const GROUP_KSUID_RESOURCE = "group";
const ROLE_BINDING_KSUID_RESOURCE = "rolebinding";

/**
 * How much of the user id seeds a personal slug, how much randomness follows
 * it, and how long the personal project's ingestion key is. The user prefix is
 * what makes a personal slug recognisable to support; the nanoid suffix is
 * what makes two workspaces for the same user distinct.
 */
const SLUG_USER_PREFIX_CHARS = 12;
const SLUG_SUFFIX_CHARS = 6;
const PERSONAL_PROJECT_API_KEY_CHARS = 40;

/** `team_` plus the first five nanoid characters — the team slug's distinguishing tail. */
const TEAM_ID_SLUG_CHARS = 11;

/**
 * The slug a shared team or an organization group is given.
 *
 * A slug is the segment a customer sees in a URL and pastes into a link, so
 * the order of the two steps matters: the separators a customer types (`:`,
 * `?`, `&`, `_`) become dashes BEFORE `slugify` sees them — otherwise its
 * character map would expand `&` into the word "and" mid-name — and everything
 * remaining is reduced by `strict` mode to lower-case ASCII words joined by a
 * single dash.
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
 * A team id is deliberately NOT a KSUID: teams predate the scheme and their
 * rows carry the `team_` + nanoid shape, which the slug then quotes the first
 * eleven characters of. The binding minted alongside it IS a KSUID, because
 * bindings were introduced after the scheme.
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
 * Unlike a team, a group's id is a KSUID and its slug carries no id tail — the
 * organization service appends its own disambiguating suffix when a base slug
 * is already taken, which is why `slugify` here returns the BASE slug and
 * nothing more.
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
