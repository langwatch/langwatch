/**
 * Rotating, re-scoping and reading the CLI sessions a device grant minted.
 * @see specs/ai-gateway/governance/cli-login.feature
 */

import { ProjectInvalidCredentialsError } from "@langwatch/api";
import { type CliSessionRevocationCause } from "@langwatch/api-key-contract";
import { CliDeviceFlowRefusedError, refreshRequestSchema } from "@langwatch/auth-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import {
  posted,
  isProjectGone,
  answer,
  type CliDeviceFlowAnswer,
} from "../rules/cli-device-flow.rules.ts";
import type { CliAccessProject } from "../../../services/api-rest-credentials.service.ts";
import type { AuthDirectoryProject } from "./cli-device-directory.service.ts";
import type { CliDeviceFlowCollaborators } from "./cli-device-flow.service.ts";
import { type CliRefreshTokenRecord, type CliMintedSession } from "./cli-device-session.service.ts";

const logger = createLogger("langwatch:auth-cli");

/** One OAuth refusal, in the two-field shape RFC 8628 clients parse. */
function refused(error: string, description: string, status: number): CliDeviceFlowRefusedError {
  return new CliDeviceFlowRefusedError({
    refusal: { error, error_description: description },
    httpStatus: status,
  });
}

/**
 * Sliding-window rotation. A rotation mints a new credential pair, so it
 * re-derives membership the way the other minting endpoints do.
 */
async function refresh({
  flow,
  raw,
}: {
  flow: CliDeviceFlowCollaborators;
  raw: string;
}): Promise<CliDeviceFlowAnswer> {
  const parsed = refreshRequestSchema.safeParse(posted(raw));

  if (!parsed.success) throw refused("invalid_request", "refresh_token is required", 400);

  const rotated = await rotateRefreshToken({
    flow,
    refreshToken: parsed.data.refresh_token,
    projectRef: parsed.data.project_id ?? parsed.data.project_slug,
  });

  return answer({
    access_token: rotated.accessToken,
    token_type: "Bearer",
    expires_in: rotated.accessTtlSeconds,
    refresh_token: rotated.refreshToken,
    refresh_expires_in: rotated.refreshTtlSeconds,
    ...(rotated.project ? { project: rotated.project } : {}),
  });
}

/** A rotated or forked pair, and the project it is capped at where it is capped at one. */
export type CliRotatedSession = CliMintedSession &
  Readonly<{ project?: Readonly<{ id: string; slug: string; name: string }> }>;

/** One rotation of a refresh token, for the CLI's `/refresh` and for any peer holding a pair. */
async function rotateRefreshToken({
  flow,
  refreshToken: refresh_token,
  projectRef,
}: {
  flow: CliDeviceFlowCollaborators;
  refreshToken: string;
  /** A project id or slug to re-scope the rotated pair to; the person's access is checked. */
  projectRef?: string | undefined;
}): Promise<CliRotatedSession> {
  const record = await flow.sessions().getRefreshToken(refresh_token);

  // One rotation per token: a concurrent second presentation is refused as spent.
  if (!(await flow.sessions().claimRotation(refresh_token))) {
    throw refused("invalid_grant", "Refresh token is invalid or revoked", 401);
  }

  try {
    return await rotateClaimed({ flow, refreshToken: refresh_token, record, projectRef });
  } catch (error) {
    // Any failure hands the claim back: a dropped token stays dropped, a live one stays usable.
    await flow.sessions().releaseRotationClaim(refresh_token);
    throw error;
  }
}

/** The rotation a held claim buys: re-proves the session, then rotates or forks it. */
/** Refuses a rotation the session may no longer make; answers the anchor and policy it used. */
async function assertSessionAdmitted({
  flow,
  refreshToken: refresh_token,
  record,
}: {
  flow: CliDeviceFlowCollaborators;
  refreshToken: string;
  record: CliRefreshTokenRecord;
}): Promise<{ sessionAnchorMs: number; maxDurationDays: number }> {
  if (nowInstant().epochMilliseconds > record.expires_at) {
    await flow.sessions().dropRefreshToken(refresh_token);
    await retireSessionKey({ flow, record, cause: "expired" });

    throw refused("invalid_grant", "Refresh token has expired", 401);
  }

  // Enforce the admin-configured maximum session duration. The anchor is
  // `client_info.session_started_at` (set at exchange and preserved across
  // rotations), falling back to the record's issue time for sessions started
  // before device metadata was captured.
  const sessionAnchorMs = record.client_info?.session_started_at ?? record.issued_at;
  const maxDurationDays = await flow.directory().maxSessionDurationDays(record.organization_id);

  if (maxDurationDays > 0) {
    const sessionAgeMs = nowInstant().epochMilliseconds - sessionAnchorMs;

    if (sessionAgeMs > maxDurationDays * 24 * 60 * 60 * 1000) {
      // Reject AND invalidate the old refresh token, so no further rotation is
      // attempted. The CLI gets 401 and wipes local state.
      await flow.sessions().dropRefreshToken(refresh_token);
      await retireSessionKey({ flow, record, cause: "expired" });
      logger.info(
        {
          userId: record.user_id,
          organizationId: record.organization_id,
          sessionAgeDays: Math.round(sessionAgeMs / 86_400_000),
          maxDurationDays,
        },
        "rejecting refresh: session exceeded org max-duration policy",
      );

      throw refused(
        "invalid_grant",
        `Session exceeded organization max-duration policy of ${maxDurationDays} days. Please run \`langwatch login\` to start a new session.`,
        401,
      );
    }
  }

  // A bearer-only route still honours the access token already in hand until it
  // expires — one hour, the same window a removed member has; this is what
  // stops that window from rolling forward for a quarter.
  const activeMembership = await flow.directory().hasActiveMembership({
    userId: record.user_id,
    organizationId: record.organization_id,
  });

  if (!activeMembership) {
    await flow.sessions().dropRefreshToken(refresh_token);
    // Not `expired`: the session had time left and lost its person instead.
    await retireSessionKey({ flow, record, cause: "offboarded" });
    logger.info(
      { userId: record.user_id, organizationId: record.organization_id },
      "rejecting refresh: caller is not an active member of the organization",
    );

    throw refused(
      "invalid_grant",
      "Your access to this organization is no longer active. Please run `langwatch login` to start a new session.",
      401,
    );
  }

  return { sessionAnchorMs, maxDurationDays };
}

/** The key's expiry slides with the refresh window, best effort (main `auth-cli.ts:1549-1568`). */
async function extendKeyExpiry({
  flow,
  record,
  sessionAnchorMs,
  maxDurationDays,
}: {
  flow: CliDeviceFlowCollaborators;
  record: CliRefreshTokenRecord;
  sessionAnchorMs: number;
  maxDurationDays: number;
}): Promise<void> {
  if (record.cli_api_key_id) {
    try {
      await flow.apiKeys().extendCliLoginKeyExpiry({
        apiKeyId: record.cli_api_key_id,
        userId: record.user_id,
        organizationId: record.organization_id,
        sessionStartedAtMs: sessionAnchorMs,
        maxSessionDurationDays: maxDurationDays,
        refreshWindowMs: flow.sessions().refreshTokenTtlSeconds * 1000,
      });
    } catch (error) {
      logger.warn(
        { error, apiKeyId: record.cli_api_key_id, userId: record.user_id },
        "[auth-cli] could not extend the CLI login key's expiry on refresh",
      );
    }
  }
}

/**
 * A refused refresh ends the session, so its login key and the ingest keys under it go now
 * (main's `retireExpiredSessionKey`); best effort, the hourly reaper is the backstop.
 */
async function retireSessionKey({
  flow,
  record,
  cause,
}: {
  flow: CliDeviceFlowCollaborators;
  record: CliRefreshTokenRecord;
  cause: CliSessionRevocationCause;
}): Promise<void> {
  if (!record.cli_api_key_id) return;

  try {
    await flow.apiKeys().revokeCliSessionKey({
      apiKeyId: record.cli_api_key_id,
      userId: record.user_id,
      organizationId: record.organization_id,
      cause,
    });
  } catch (error) {
    logger.warn(
      { error, apiKeyId: record.cli_api_key_id, userId: record.user_id },
      "[auth-cli] could not revoke the CLI login key of a refused refresh",
    );
  }
}

async function rotateClaimed({
  flow,
  refreshToken: refresh_token,
  record,
  projectRef,
}: {
  flow: CliDeviceFlowCollaborators;
  refreshToken: string;
  record: CliRefreshTokenRecord;
  projectRef: string | undefined;
}): Promise<CliRotatedSession> {
  const { sessionAnchorMs, maxDurationDays } = await assertSessionAdmitted({
    flow,
    refreshToken: refresh_token,
    record,
  });

  // Checked before anything is dropped: a refusal leaves the refresh token valid. A bound
  // project is re-proved on every rotation; a locked one never moves.
  const targetRef = projectRef ?? record.project_id;
  const scoped =
    targetRef === undefined
      ? undefined
      : await reScopedProjectOf({ flow, record, projectRef: targetRef });

  // A re-scope forks a locked child filed under the parent's family, so the parent's end is
  // the child's; the parent pair stays valid.
  const project = scoped && { id: scoped.id, slug: scoped.slug, name: scoped.name };
  if (project !== undefined && project.id !== record.project_id) {
    const child = await flow.sessions().mintSession({
      userId: record.user_id,
      organizationId: record.organization_id,
      projectId: project.id,
      projectLocked: true,
      clientInfo: record.client_info,
      parentFamilyId: await flow.sessions().familyOf({ refreshToken: refresh_token, record }),
    });
    await flow.sessions().releaseRotationClaim(refresh_token);

    return { ...child, project };
  }

  // `session_started_at` and the CLI key id are carried across so the devices
  // inventory keeps its anchor and logout can still revoke the key.
  const rotated = await flow.sessions().mintSession({
    userId: record.user_id,
    organizationId: record.organization_id,
    projectId: project?.id,
    projectLocked: record.project_locked,
    clientInfo: record.client_info,
    cliApiKeyId: record.cli_api_key_id,
    familyId: record.family_id,
    parentFamilyId: record.parent_family_id,
  });

  await extendKeyExpiry({ flow, record, sessionAnchorMs, maxDurationDays });

  await flow.sessions().dropRefreshToken(refresh_token);

  return project ? { ...rotated, project } : rotated;
}

/** The project a rotation re-scopes to, refused unless the person can view it. */
async function reScopedProjectOf({
  flow,
  record,
  projectRef,
}: {
  flow: CliDeviceFlowCollaborators;
  record: CliRefreshTokenRecord;
  projectRef: string;
}): Promise<AuthDirectoryProject> {
  const project = await flow
    .directory()
    .getLiveProjectByRef({ projectRef, organizationId: record.organization_id })
    .catch((error: unknown) => {
      if (isProjectGone(error)) return null;
      throw error;
    });
  const reaches =
    project !== null &&
    (!record.project_locked || project.id === record.project_id) &&
    (await personReachesProject({ flow, userId: record.user_id, project }));

  // One answer for a missing project, a locked session and one the person cannot reach.
  if (!project || !reaches) {
    throw refused("forbidden", "Project not found or you do not have access to it", 403);
  }

  return project;
}

/** `project:view`, and another person's personal workspace never, whatever the grant says. */
async function personReachesProject({
  flow,
  userId,
  project,
}: {
  flow: CliDeviceFlowCollaborators;
  userId: string;
  project: Readonly<{ id: string; isPersonal: boolean; ownerUserId: string | null }>;
}): Promise<boolean> {
  if (project.isPersonal && project.ownerUserId !== userId) return false;

  return flow.canViewProject({ userId, projectId: project.id });
}

/**
 * A session a sign-in outside the device grant approved (hosted MCP): capped at one project the
 * person still reaches as an active member, and locked there, so no rotation re-scopes it.
 */
async function issueLockedProjectSession({
  flow,
  userId,
  organizationId,
  projectId,
  clientLabel,
}: {
  flow: CliDeviceFlowCollaborators;
  userId: string;
  organizationId: string;
  projectId: string;
  clientLabel: string;
}): Promise<CliMintedSession> {
  const project = await flow
    .directory()
    .getLiveProject({ projectId, organizationId })
    .catch((error: unknown) => {
      if (isProjectGone(error)) return null;
      throw error;
    });
  const reaches =
    project !== null &&
    (await flow.directory().hasActiveMembership({ userId, organizationId })) &&
    (await personReachesProject({ flow, userId, project }));
  if (!project || !reaches) {
    throw refused("access_denied", "You no longer have access to the selected project", 403);
  }

  return flow.sessions().mintSession({
    userId,
    organizationId,
    projectId: project.id,
    projectLocked: true,
    clientInfo: { device_label: clientLabel, session_started_at: nowInstant().epochMilliseconds },
  });
}

/**
 * The person and live project behind a bound access bearer; anything else is
 * `invalid_credentials`.
 */
async function accessProjectOf({
  flow,
  authorization,
}: {
  flow: CliDeviceFlowCollaborators;
  authorization: string;
}): Promise<CliAccessProject> {
  const record = await flow
    .sessions()
    .getAccessToken(authorization)
    .catch((error: unknown) => {
      if (HandledError.isHandled(error) && error.code === "cli_session_record_not_found") {
        throw new ProjectInvalidCredentialsError();
      }
      throw error;
    });
  if (!record.project_id) throw new ProjectInvalidCredentialsError();

  const project = await flow
    .directory()
    .getLiveProject({ projectId: record.project_id, organizationId: record.organization_id })
    .catch((error: unknown) => {
      if (isProjectGone(error)) throw new ProjectInvalidCredentialsError();
      throw error;
    });

  return {
    userId: record.user_id,
    organizationId: record.organization_id,
    project: { ...project, organizationId: record.organization_id },
  };
}

/** Rotating, re-scoping and reading the CLI sessions a device grant minted. */
export class CliDeviceRotationService {
  static create({ flow }: { flow: CliDeviceFlowCollaborators }): CliDeviceRotationService {
    return new CliDeviceRotationService(flow);
  }

  private constructor(private readonly flow: CliDeviceFlowCollaborators) {}

  refreshSession({ raw }: { raw: string }): Promise<CliDeviceFlowAnswer> {
    return refresh({ flow: this.flow, raw });
  }

  rotateSession({ refreshToken }: { refreshToken: string }): Promise<CliRotatedSession> {
    return rotateRefreshToken({ flow: this.flow, refreshToken });
  }

  issueProjectSession(
    input: WithoutFlow<Parameters<typeof issueLockedProjectSession>[0]>,
  ): Promise<CliMintedSession> {
    return issueLockedProjectSession({ flow: this.flow, ...input });
  }

  getAccessProject({ authorization }: { authorization: string }): Promise<CliAccessProject> {
    return accessProjectOf({ flow: this.flow, authorization });
  }
}

type WithoutFlow<Input> = Omit<Input, "flow">;
