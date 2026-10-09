/**
 * The CLI poll that redeems an approved device code for a session.
 * @see specs/ai-gateway/governance/cli-login.feature
 */

import type { clientInfoSchema } from "@langwatch/auth-contract";
import { CliDeviceFlowRefusedError, exchangeRequestSchema } from "@langwatch/auth-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import type { z } from "zod";

import {
  expired,
  posted,
  isPersonOrOrganizationGone,
  isProjectGone,
  answer,
  type CliDeviceFlowAnswer,
} from "../rules/cli-device-flow.rules.ts";
import type { CliDeviceFlowCollaborators } from "./cli-device-flow.service.ts";
import type { CliDeviceKeysService } from "./cli-device-keys.service.ts";
import { type CliClientInfo, type CliDeviceCodeRecord } from "./cli-device-session.service.ts";

const logger = createLogger("langwatch:auth-cli");

/** One OAuth refusal, in the two-field shape RFC 8628 clients parse. */
function refused(error: string, description: string, status: number): CliDeviceFlowRefusedError {
  return new CliDeviceFlowRefusedError({
    refusal: { error, error_description: description },
    httpStatus: status,
  });
}

/**
 * A settled code skips the poll window: that poll is the one the approval
 * stream just told the CLI to make. An unknown code still claims it, then 408s.
 */
function settledDeviceCode({
  flow,
  deviceCode,
}: {
  flow: CliDeviceFlowCollaborators;
  deviceCode: string;
}) {
  return flow
    .sessions()
    .getDeviceCode(deviceCode)
    .then((found) => (found.status === "pending" ? undefined : found))
    .catch((error: unknown) => {
      if (error instanceof CliDeviceFlowRefusedError) return undefined;
      throw error;
    });
}

/** The approved record this poll may redeem: past the poll window, the state check, the claim. */
async function redeemableRecord({
  flow,
  deviceCode,
}: {
  flow: CliDeviceFlowCollaborators;
  deviceCode: string;
}): Promise<CliDeviceCodeRecord & { user_id: string; organization_id: string }> {
  const settled = await settledDeviceCode({ flow, deviceCode });

  // Per-device polling rate limit, claimed atomically: RFC 8628 says clients
  // respect the server-issued interval, but a defensive server enforces it.
  if (!settled && !(await flow.sessions().claimPollWindow(deviceCode))) {
    throw refused("slow_down", "Polling too fast. Increase your interval before retrying.", 429);
  }

  const record = settled ?? (await flow.sessions().getDeviceCode(deviceCode));

  await assertExchangeable({ flow, record, deviceCode });

  if (!record.user_id || !record.organization_id) {
    // Should not happen — approval always populates these. Treated as a
    // transient pending state so the CLI keeps polling rather than crashing.
    logger.warn(
      `[auth-cli] approved device_code ${deviceCode} missing user/org payload — returning pending`,
    );

    throw refused("authorization_pending", "Approval received but session not ready yet", 428);
  }

  // Exclusive redemption: poll pacing is not a credential fence, so the loser
  // gets the same retriable `slow_down` a too-fast poll gets.
  if (!(await flow.sessions().claimExchange(deviceCode))) {
    throw refused("slow_down", "Polling too fast. Increase your interval before retrying.", 429);
  }

  return { ...record, user_id: record.user_id, organization_id: record.organization_id };
}

/** The person and organization behind a record, re-derived and still an active member. */
async function activeMemberOf({
  flow,
  record,
  deviceCode,
}: {
  flow: CliDeviceFlowCollaborators;
  record: CliDeviceCodeRecord & { user_id: string; organization_id: string };
  deviceCode: string;
}) {
  const directory = flow.directory();
  const [user, organization] = await Promise.all([
    directory.getPerson(record.user_id),
    directory.getOrganization(record.organization_id),
  ]).catch(async (error: unknown) => {
    if (!isPersonOrOrganizationGone(error)) throw error;
    logger.error(
      `[auth-cli] approved device_code refers to missing user (${record.user_id}) or org (${record.organization_id})`,
    );
    // Nothing was consumed, so the code stays redeemable for whatever retry
    // the CLI makes next.
    await flow.sessions().releaseExchangeClaim(deviceCode);

    throw refused("server_error", "User or organization no longer exists", 500);
  });

  // Membership is re-derived HERE, not trusted from approval time: an admin
  // can disable the seat between approve and exchange. Refused, the device
  // code is consumed and answered with the same fatal 410 a removed member's
  // mint already gives, so the CLI stops polling for good.
  const activeMembership = await flow.directory().hasActiveMembership({
    userId: user.id,
    organizationId: organization.id,
  });

  if (!activeMembership) {
    await flow.sessions().consumeDeviceCode({ record, alsoPollWindow: true });
    // The claim would otherwise outlive the code it was serialising.
    await flow.sessions().releaseExchangeClaim(deviceCode);

    throw refused("access_denied", "Not an active member of the organization", 410);
  }

  return { user, organization };
}

/**
 * The CLI's poll. The order is the family's whole security argument: the poll
 * window, then the record's own state, then the membership re-derived from
 * rows rather than trusted from approval time.
 */
async function exchange({
  flow,
  keys,
  raw,
}: {
  flow: CliDeviceFlowCollaborators;
  keys: CliDeviceKeysService;
  raw: string;
}): Promise<CliDeviceFlowAnswer> {
  const parsed = exchangeRequestSchema.safeParse(posted(raw));

  if (!parsed.success) throw refused("invalid_request", "device_code is required", 400);

  const { device_code } = parsed.data;

  const record = await redeemableRecord({ flow, deviceCode: device_code });
  const { user, organization } = await activeMemberOf({ flow, record, deviceCode: device_code });

  const endpoint = controlPlaneBaseUrlOf(flow);

  if ((record.credential_type ?? "device_session") === "project_api_key") {
    return projectSessionAnswer({
      flow,
      record,
      user,
      organization,
      endpoint,
      clientInfo: parsed.data.client_info,
    });
  }

  const personalProject = await keys.personalProjectFieldsOf({ user, organization });
  // One instant stamps the session and anchors the login key's expiry.
  const sessionStartedAtMs = nowInstant().epochMilliseconds;
  const minted = await keys.mintCliKey({
    record,
    user,
    organization,
    clientInfo: parsed.data.client_info,
    sessionStartedAtMs,
  });

  // Stamp the device info so the devices inventory can show a recognisable
  // entry. `session_started_at` is preserved through later rotations so the
  // dashboard shows "logged in 5 days ago" rather than the rotation moment.
  const clientInfo: CliClientInfo | undefined = parsed.data.client_info
    ? { ...parsed.data.client_info, session_started_at: sessionStartedAtMs }
    : undefined;
  const session = await flow.sessions().mintSession({
    userId: user.id,
    organizationId: organization.id,
    clientInfo,
    cliApiKeyId: minted.apiKeyId,
  });

  // Single-use device code: consumed after a successful exchange, poll window
  // included, so the next poll learns the code is gone (408) rather than that
  // it polled too soon (429). The CLAIM is deliberately left to expire — see
  // `releaseExchangeClaim`.
  await flow.sessions().consumeDeviceCode({ record, alsoPollWindow: true });

  return answer({
    kind: "device_session" as const,
    access_token: session.accessToken,
    token_type: "Bearer" as const,
    expires_in: session.accessTtlSeconds,
    refresh_token: session.refreshToken,
    refresh_expires_in: session.refreshTtlSeconds,
    user: { id: user.id, email: user.email, name: user.name },
    organization: { id: organization.id, name: organization.name, slug: organization.slug },
    default_personal_vk: record.personal_vk,
    ...personalProject,
    // The user-scoped key and its reach summary. Additive: an older CLI
    // ignores both and keeps using `personal_project` exactly as before.
    ...(minted.token && minted.scope
      ? { cli_api_key: minted.token, cli_api_key_scope: minted.scope }
      : {}),
    endpoint,
  });
}

/**
 * Refuses a grant that cannot be exchanged yet, or at all, in RFC 8628's own
 * codes; returns once the record is approved and still inside its window.
 */
async function assertExchangeable({
  flow,
  record,
  deviceCode,
}: {
  flow: CliDeviceFlowCollaborators;
  record: CliDeviceCodeRecord;
  deviceCode: string;
}): Promise<void> {
  // Server-side expiry check, in case the store has not evicted yet.
  if (expired(record)) {
    await flow.sessions().consumeDeviceCode({ record });

    throw refused("expired_token", "Device code expired", 408);
  }

  if (record.status === "denied") {
    await flow.sessions().consumeDeviceCode({ record });

    throw refused("access_denied", "Authorization request was denied by the user", 410);
  }

  if (record.status === "pending") {
    throw refused("authorization_pending", "User has not yet completed authorization", 428);
  }

  if (record.status === "expired") throw refused("expired_token", "Device code expired", 408);

  if (record.status === "approved") return;

  // Defensive: an unrecognised status.
  logger.warn(`[auth-cli] device_code ${deviceCode} carries an unrecognised state`);

  throw refused("server_error", "Unknown device code state", 500);
}

/** Binds a session to the picked project after re-reading access and state. Hands out no key. */
async function projectSessionAnswer({
  flow,
  record,
  user,
  organization,
  endpoint,
  clientInfo,
}: {
  flow: CliDeviceFlowCollaborators;
  record: CliDeviceCodeRecord;
  user: Readonly<{ id: string; email: string | null; name: string | null }>;
  organization: Readonly<{ id: string; name: string; slug: string }>;
  endpoint: string;
  clientInfo: z.output<typeof clientInfoSchema>;
}): Promise<CliDeviceFlowAnswer> {
  if (!record.project) {
    logger.warn(
      `[auth-cli] approved project device_code ${record.device_code} missing project payload — returning pending`,
    );
    // Transient, and nothing was consumed: the claim goes back so the CLI's
    // next poll is not told to slow down for half a minute.
    await flow.sessions().releaseExchangeClaim(record.device_code);

    throw refused("authorization_pending", "Approval received but project not ready yet", 428);
  }

  const project = await flow
    .directory()
    .getLiveProject({ projectId: record.project.project_id, organizationId: organization.id })
    .catch((error: unknown) => {
      if (isProjectGone(error)) return null;
      throw error;
    });
  const stillReaches =
    project !== null && (await flow.canViewProject({ userId: user.id, projectId: project.id }));
  const ownsItIfPersonal =
    project !== null && (!project.isPersonal || project.ownerUserId === user.id);

  if (!project || !stillReaches || !ownsItIfPersonal) {
    // One answer for all three, because they are one fact to the caller: this
    // exchange is not entitled to that project. Which of the three it was is a
    // detail about somebody else's project, and 410 stops the CLI polling for
    // a session it will never get.
    await flow.sessions().consumeDeviceCode({ record, alsoPollWindow: true });
    await flow.sessions().releaseExchangeClaim(record.device_code);

    throw refused("access_denied", "You no longer have access to the selected project", 410);
  }

  const sessionStartedAtMs = nowInstant().epochMilliseconds;
  // Locked: the approver consented to this one project, so no refresh re-scopes it.
  const session = await flow.sessions().mintSession({
    userId: user.id,
    organizationId: organization.id,
    projectId: project.id,
    projectLocked: true,
    clientInfo: clientInfo ? { ...clientInfo, session_started_at: sessionStartedAtMs } : undefined,
  });

  // Single-use device code, poll window included; the claim is deliberately
  // left to expire — see `releaseExchangeClaim`.
  await flow.sessions().consumeDeviceCode({ record, alsoPollWindow: true });

  return answer({
    kind: "project_session" as const,
    access_token: session.accessToken,
    token_type: "Bearer" as const,
    expires_in: session.accessTtlSeconds,
    refresh_token: session.refreshToken,
    refresh_expires_in: session.refreshTtlSeconds,
    project: { id: project.id, slug: project.slug, name: project.name },
    user: { id: user.id, email: user.email, name: user.name },
    organization: { id: organization.id, name: organization.name, slug: organization.slug },
    endpoint,
  });
}

/**
 * Control-plane base URL the CLI persists post-login (no trailing slash).
 * Falls back to `https://flow.langwatch.ai`, the same fallback the CLI uses
 * client-side, so the round-trip self-hosted experience stays consistent.
 */
function controlPlaneBaseUrlOf(flow: CliDeviceFlowCollaborators): string {
  return (flow.publicBaseUrl() ?? "https://flow.langwatch.ai").replace(/\/+$/, "");
}

/** The CLI poll that redeems an approved device code: the grant's `/exchange` step. */
export class CliDeviceExchangeService {
  static create({
    flow,
    keys,
  }: {
    flow: CliDeviceFlowCollaborators;
    keys: CliDeviceKeysService;
  }): CliDeviceExchangeService {
    return new CliDeviceExchangeService(flow, keys);
  }

  private constructor(
    private readonly flow: CliDeviceFlowCollaborators,
    private readonly keys: CliDeviceKeysService,
  ) {}

  exchangeDeviceCode({ raw }: { raw: string }): Promise<CliDeviceFlowAnswer> {
    return exchange({ flow: this.flow, keys: this.keys, raw });
  }
}
