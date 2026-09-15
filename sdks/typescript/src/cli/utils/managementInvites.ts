/**
 * The invite grammar, which is the one management shape with two spellings.
 *
 * An invited person always lands on at least one team, and the role they hold
 * is per team, so an invite is a small tree rather than a value. Repeated flags
 * spell the common case (a few people onto the same teams); the JSON forms
 * carry per-person team assignments and custom roles. Both produce the same
 * request, so a run that started as flags can be captured as JSON without
 * changing what happens.
 *
 * It lives beside `managementFlags` rather than inside it because the JSON form
 * validates a document the caller wrote, which is a different job from reading
 * a single colon-separated flag.
 */
import { ORGANIZATION_ROLES } from "@/client-sdk/services/_shared/management-types";
import type { ManagementRole } from "@/client-sdk/services/_shared/management-types";
import type { InviteInput } from "@/client-sdk/services/organization/organization-api.service";
import { ManagementFlagError, oneOf, parseOrganizationRole, parseRoleIn } from "./managementFlags";

type TeamAssignment = InviteInput["teams"][number];

/**
 * A local name, an `@`, and a domain carrying a dot. Deliberately not RFC 5322:
 * the CLI's job here is to catch the typo the caller can see and fix, not to
 * adjudicate address syntax, which the platform does when it sends the mail.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * One invited address, refused before the batch is sent.
 *
 * An invite batch is all-or-nothing at the platform, so one mistyped address
 * costs the caller the whole run. `source` names which one was wrong.
 */
const parseEmail = ({ value, source }: { value: string; source: string }): string => {
  const email = value.trim();
  if (!EMAIL_SHAPE.test(email)) {
    throw new ManagementFlagError(
      `Invalid email "${value}" in ${source}. Expected an address like person@example.com.`,
    );
  }
  return email;
};

/**
 * `teamId:role`, repeated: the teams an invited person lands on and the role
 * they hold there. A team id never contains a colon.
 */
export const parseTeamFlags = (
  values: string[] = [],
): Array<{ teamId: string; role: ManagementRole }> =>
  values.map((value) => {
    const parts = value.split(":");
    if (parts.length !== 2 || parts.some((part) => !part.trim())) {
      throw new ManagementFlagError(
        `Invalid team assignment "${value}". Expected teamId:role, for example team_abc:MEMBER.`,
      );
    }
    return {
      teamId: parts[0]!.trim(),
      role: parseRoleIn({
        value: parts[1]!,
        source: `team assignment "${value}"`,
      }),
    };
  });

export interface InviteFlagInput {
  /** Repeatable `--email`. */
  email?: string[];
  /** Repeatable `--role`; one per email, or one for the whole batch. */
  role?: string[];
  /** Repeatable `--team teamId:role`, applied to every invite in the batch. */
  team?: string[];
}

/**
 * The invite batch the flags describe.
 *
 * One `--role` covers the whole batch; several must line up one-per-email, so
 * a mismatch is caught here rather than silently pairing the wrong role with
 * the wrong person. The team assignments apply to every invite in the batch:
 * an invite with per-person teams is a JSON batch, which the same command
 * accepts through `--json`, `--file` or `--stdin`.
 */
export const composeInvitesFromFlags = (options: InviteFlagInput): InviteInput[] => {
  const emails = (options.email ?? []).map((email) => email.trim()).filter(Boolean);
  if (emails.length === 0) {
    throw new ManagementFlagError(
      "No invites given. Pass --email (repeatable) with --role and --team, or a JSON batch with --json, --file or --stdin.",
    );
  }

  const roles = options.role ?? [];
  if (roles.length !== 1 && roles.length !== emails.length) {
    throw new ManagementFlagError(
      `Got ${emails.length} email flags and ${roles.length} role flags. Pass one --role for the whole batch, or one per --email.`,
    );
  }

  const teams = parseTeamFlags(options.team);
  if (teams.length === 0) {
    throw new ManagementFlagError(
      "Every invite needs at least one team. Pass --team teamId:role (repeatable).",
    );
  }

  return emails.map((email, index) => ({
    email: parseEmail({ value: email, source: "--email" }),
    role: parseOrganizationRole(roles.length === 1 ? roles[0]! : roles[index]!),
    teams: teams.map((team) => ({ teamId: team.teamId, role: team.role })),
  }));
};

/** A custom role id out of a JSON batch, or undefined when none was given. */
const parseCustomRoleId = ({
  value,
  source,
}: {
  value: unknown;
  source: string;
}): string | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new ManagementFlagError(
      `${source} has a customRoleId that is not a role id. Expected the id of a custom role.`,
    );
  }
  return value.trim();
};

/** One `{ teamId, role }` entry out of a JSON invite. */
const parseTeamAssignment = ({
  team,
  source,
  roleSource,
}: {
  team: unknown;
  source: string;
  roleSource: string;
}): TeamAssignment => {
  const assignment = team as Partial<TeamAssignment> | null;
  if (!assignment || typeof assignment.teamId !== "string" || !assignment.teamId.trim()) {
    throw new ManagementFlagError(`${source} has no teamId.`);
  }
  const customRoleId = parseCustomRoleId({
    value: assignment.customRoleId,
    source,
  });
  return {
    teamId: assignment.teamId.trim(),
    role: parseRoleIn({
      value: typeof assignment.role === "string" ? assignment.role : "",
      source: roleSource,
    }),
    ...(customRoleId !== undefined ? { customRoleId } : {}),
  };
};

/** One invite out of a JSON batch, numbered so a refusal says which one. */
const parseInviteEntry = ({ entry, index }: { entry: unknown; index: number }): InviteInput => {
  const invite = entry as Partial<InviteInput> | null;
  const position = `Invite ${index + 1}`;
  if (!invite || typeof invite.email !== "string" || !invite.email.trim()) {
    throw new ManagementFlagError(
      `${position} has no email. Every invite needs email, role and teams.`,
    );
  }
  const email = parseEmail({
    value: invite.email,
    source: position.toLowerCase(),
  });
  if (typeof invite.role !== "string") {
    throw new ManagementFlagError(
      `${position} ("${invite.email}") has no role. Expected one of ${oneOf(ORGANIZATION_ROLES)}.`,
    );
  }
  const teams = invite.teams;
  if (!Array.isArray(teams) || teams.length === 0) {
    throw new ManagementFlagError(
      `${position} ("${invite.email}") has no teams. Every invite needs at least one team assignment.`,
    );
  }

  return {
    email,
    role: parseOrganizationRole(invite.role),
    teams: teams.map((team, teamIndex) =>
      parseTeamAssignment({
        team,
        source: `${position} ("${email}") team ${teamIndex + 1}`,
        roleSource: `invite ${index + 1} team ${teamIndex + 1}`,
      }),
    ),
  };
};

/**
 * The invite batch a JSON document describes. Both the bare array and the
 * `{ invites: [...] }` envelope are accepted, because the first is what a
 * person writes and the second is what the API answers with, and pasting back
 * a previous response is the obvious thing to try.
 */
export const parseInvitesJson = (raw: string): InviteInput[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ManagementFlagError("Invalid JSON: could not parse the invite batch.");
  }

  const invites = Array.isArray(parsed)
    ? parsed
    : (parsed as { invites?: unknown } | null)?.invites;

  if (!Array.isArray(invites)) {
    throw new ManagementFlagError(
      'Invalid invite batch: expected a JSON array of invites, or an object with an "invites" array.',
    );
  }
  if (invites.length === 0) {
    throw new ManagementFlagError("Invalid invite batch: the invites array is empty.");
  }

  return invites.map((entry, index) => parseInviteEntry({ entry, index }));
};
