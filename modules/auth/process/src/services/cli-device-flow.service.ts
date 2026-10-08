import { type ApiKeyApi } from "@langwatch/api-key-contract";
import type { lookupQuerySchema } from "@langwatch/auth-contract";
import {
  CliDeviceFlowRefusedError,
  denyRequestSchema,
  deviceCodeRequestSchema,
} from "@langwatch/auth-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type * as zodModule from "zod";

import {
  answer,
  expired,
  posted,
  type CliDeviceFlowAnswer,
} from "../rules/cli-device-flow.rules.ts";
import type { CliAccessProject } from "./api-rest-credentials.service.ts";
import {
  type CliDeviceApprovalFrame,
  CliDeviceApprovalService,
} from "./cli-device-approval.service.ts";
import { CliDeviceApproveService } from "./cli-device-approve.service.ts";
import type { CliDeviceDirectory } from "./cli-device-directory.service.ts";
import { CliDeviceExchangeService } from "./cli-device-exchange.service.ts";
import { CliDeviceKeysService } from "./cli-device-keys.service.ts";
import { CliDeviceRotationService, type CliRotatedSession } from "./cli-device-rotation.service.ts";
import {
  DEVICE_CODE_TTL_SECONDS,
  MIN_POLL_INTERVAL_SECONDS,
  type CliDeviceSessionService,
  type CliMintedSession,
} from "./cli-device-session.service.ts";

/** The CLI device grant (RFC 8628). @see specs/ai-governance/cli-onboarding/ */
/** One OAuth refusal, in the two-field shape RFC 8628 clients parse. */
function refused(error: string, description: string, status: number): CliDeviceFlowRefusedError {
  return new CliDeviceFlowRefusedError({
    refusal: { error, error_description: description },
    httpStatus: status,
  });
}

/** The personal workspace a device session names. */
type CliPersonalWorkspace = Readonly<{
  team: Readonly<{ id: string }>;
  project: Readonly<{ id: string; slug: string; name: string }>;
}>;

/** Who is signed in, as this process resolves a browser session. */
export type CliBrowserSession = Readonly<{
  id: string;
  name?: string | null;
  email?: string | null;
  impersonator?: Readonly<{ id: string }>;
}>;

/** What the approval page's lookup reads: the query and the browser's own headers. */
export type CliDeviceCodeLookup = Readonly<{
  input: zodModule.infer<typeof lookupQuerySchema>;
  headers: Headers;
}>;

export type { CliDeviceFlowAnswer };

/** What the device grant runs on. */
export interface CliDeviceFlowCollaborators {
  /** The grant's own state: device codes, the poll window, the token pair. */
  sessions: () => CliDeviceSessionService;
  /**
   * The typed client the identity and membership reads run on. Membership is
   * re-derived from rows, not trusted from the record: an admin can disable a
   * seat between approve and exchange.
   */
  directory: () => CliDeviceDirectory;
  /** The person a browser cookie names, for the three approval-page routes. */
  session: (headers: Headers) => Promise<CliBrowserSession | null>;
  /**
   * The credential service the user-scoped CLI key is minted and revoked
   * through — the SAME one every other door on this process authenticates on.
   */
  apiKeys: () => Pick<
    ApiKeyApi,
    | "mintCliLoginKey"
    | "validateCliSelection"
    | "findDefaultCliSelection"
    | "revokeCliLoginKeyForLogout"
    | "revokeCliSessionKey"
    | "extendCliLoginKeyExpiry"
  >;
  /** Resolves or creates the caller's personal workspace. */
  ensurePersonalWorkspace: (input: {
    organizationId: string;
    userId: string;
    displayName?: string | null;
    displayEmail?: string | null;
  }) => Promise<CliPersonalWorkspace>;
  /** Whether the person holds `project:view` there: the bar a project session is bound at. */
  canViewProject: (input: { userId: string; projectId: string }) => Promise<boolean>;
  /** This deployment's flag store, for the device journey's rollout gate. */
  featureFlags: () => Pick<FeatureFlagApi, "isEnabled">;
  /** The deployment's public origin, or none. */
  publicBaseUrl: () => string | undefined;
}

/** The device grant's operations, each one route of `/api/auth/cli`, over its collaborators. */
export class CliDeviceFlowService {
  readonly #flow: CliDeviceFlowCollaborators;
  readonly #approvals: CliDeviceApprovalService;
  readonly #exchange: CliDeviceExchangeService;
  readonly #rotation: CliDeviceRotationService;
  readonly #approve: CliDeviceApproveService;

  private constructor(flow: CliDeviceFlowCollaborators) {
    this.#flow = flow;
    this.#approvals = CliDeviceApprovalService.create({ sessions: flow.sessions });
    const keys = CliDeviceKeysService.create({ flow });
    this.#exchange = CliDeviceExchangeService.create({ flow, keys });
    this.#rotation = CliDeviceRotationService.create({ flow });
    this.#approve = CliDeviceApproveService.create({ flow, keys });
  }

  static create({
    collaborators,
  }: {
    collaborators: CliDeviceFlowCollaborators;
  }): CliDeviceFlowService {
    return new CliDeviceFlowService(collaborators);
  }

  startDeviceCode({ raw }: { raw: string }): Promise<CliDeviceFlowAnswer> {
    return startDeviceFlow({ flow: this.#flow, raw });
  }

  exchangeDeviceCode(input: { raw: string }): Promise<CliDeviceFlowAnswer> {
    return this.#exchange.exchangeDeviceCode(input);
  }

  refreshSession(input: { raw: string }): Promise<CliDeviceFlowAnswer> {
    return this.#rotation.refreshSession(input);
  }

  rotateSession(input: { refreshToken: string }): Promise<CliRotatedSession> {
    return this.#rotation.rotateSession(input);
  }

  issueProjectSession(input: {
    userId: string;
    organizationId: string;
    projectId: string;
    clientLabel: string;
  }): Promise<CliMintedSession> {
    return this.#rotation.issueProjectSession(input);
  }

  getAccessProject(input: { authorization: string }): Promise<CliAccessProject> {
    return this.#rotation.getAccessProject(input);
  }

  lookupDeviceCode(input: CliDeviceCodeLookup): Promise<CliDeviceFlowAnswer> {
    return lookupDeviceFlow({ flow: this.#flow, ...input });
  }

  approveDeviceCode(input: { raw: string; headers: Headers }): Promise<CliDeviceFlowAnswer> {
    return this.#approve.approveDeviceCode(input);
  }

  denyDeviceCode(input: { raw: string; headers: Headers }): Promise<CliDeviceFlowAnswer> {
    return denyDeviceFlow({ flow: this.#flow, ...input });
  }

  endSession(input: { raw: string }): Promise<CliDeviceFlowAnswer> {
    return this.#approve.endSession(input);
  }

  watchDeviceApproval(input: {
    deviceCode: string;
    signal: AbortSignal | undefined;
  }): Promise<AsyncIterable<CliDeviceApprovalFrame>> {
    return this.#approvals.watch(input);
  }
}

/** Where a person opens the approval page. */
function verificationUriOf(flow: CliDeviceFlowCollaborators): string {
  return `${(flow.publicBaseUrl() ?? "http://localhost:5560").replace(/\/+$/, "")}/cli/auth`;
}

async function startDeviceFlow({
  flow,
  raw,
}: {
  flow: CliDeviceFlowCollaborators;
  raw: string;
}): Promise<CliDeviceFlowAnswer> {
  const parsed = deviceCodeRequestSchema.safeParse(posted(raw));

  if (!parsed.success) {
    throw refused("invalid_request", parsed.error.issues[0]?.message ?? "invalid body", 400);
  }

  const record = await flow.sessions().startDeviceCode({
    credentialType: parsed.data.credential_type,
    management: parsed.data.management,
  });
  const verificationUri = verificationUriOf(flow);

  return answer({
    device_code: record.device_code,
    user_code: record.user_code,
    verification_uri: verificationUri,
    verification_uri_complete: `${verificationUri}?user_code=${encodeURIComponent(record.user_code)}`,
    expires_in: DEVICE_CODE_TTL_SECONDS,
    interval: MIN_POLL_INTERVAL_SECONDS,
  });
}

async function lookupDeviceFlow({
  flow,
  input,
  headers,
}: {
  flow: CliDeviceFlowCollaborators;
  input: zodModule.infer<typeof lookupQuerySchema>;
  headers: Headers;
}): Promise<CliDeviceFlowAnswer> {
  const person = await flow.session(headers);

  if (!person) throw refused("unauthorized", "Sign in to continue", 401);

  if (!input.user_code) throw refused("invalid_request", "user_code is required", 400);

  const record = await flow.sessions().getDeviceCodeByUserCode({
    userCode: input.user_code,
    unknownDescription: "Code not recognised — it may have expired",
  });

  if (expired(record)) {
    throw refused("expired", "Code has expired — restart `langwatch login`", 410);
  }

  return answer({
    user_code: record.user_code,
    status: record.status,
    created_at: record.created_at,
    expires_at: record.expires_at,
    // The approval page branches its journey on this: `device_session` shows
    // the approve-only flow, `project_api_key` shows a project picker whose
    // choice binds the CLI's session. Defaults for records minted before the field.
    credential_type: record.credential_type ?? "device_session",
    // The approval screen adds management access to the key's default
    // permissions when the CLI asked for it with `--management`.
    management: record.management === true,
  });
}

async function denyDeviceFlow({
  flow,
  raw,
  headers,
}: {
  flow: CliDeviceFlowCollaborators;
  raw: string;
  headers: Headers;
}): Promise<CliDeviceFlowAnswer> {
  const person = await flow.session(headers);

  if (!person) throw refused("unauthorized", "Sign in to continue", 401);

  const parsed = denyRequestSchema.safeParse(posted(raw));

  if (!parsed.success) throw refused("invalid_request", "user_code is required", 400);

  await flow.sessions().denyDeviceCodeByUserCode(parsed.data.user_code);

  return answer({ ok: true });
}
