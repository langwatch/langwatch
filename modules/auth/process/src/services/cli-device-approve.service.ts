/**
 * The browser side of the device grant: approving a code and ending a session.
 * @see specs/ai-gateway/governance/cli-login.feature
 */

import {
  CliDeviceFlowRefusedError,
  approveRequestSchema,
  logoutRequestSchema,
} from "@langwatch/auth-contract";
import { PermissionDeniedError } from "@langwatch/authorization";
import type { FeatureFlagKey, FeatureFlagTarget } from "@langwatch/feature-flag-contract";
import { createLogger } from "@langwatch/observability";

import {
  expired,
  posted,
  isProjectGone,
  answer,
  type CliDeviceFlowAnswer,
} from "../rules/cli-device-flow.rules.ts";
import type { CliBrowserSession, CliDeviceFlowCollaborators } from "./cli-device-flow.service.ts";
import type { CliDeviceKeysService } from "./cli-device-keys.service.ts";
import { type CliDeviceCodeRecord } from "./cli-device-session.service.ts";

const logger = createLogger("langwatch:auth-cli");

/** The flag that gates the device-session journey. */
const GOVERNANCE_RELEASE_FLAG: FeatureFlagKey = "release_ui_ai_governance_enabled";

/** One OAuth refusal, in the two-field shape RFC 8628 clients parse. */
function refused(error: string, description: string, status: number): CliDeviceFlowRefusedError {
  return new CliDeviceFlowRefusedError({
    refusal: { error, error_description: description },
    httpStatus: status,
  });
}

/** The record a code names, which must be live and still waiting for its approval. */
async function pendingRecordFor({
  flow,
  userCode,
}: {
  flow: CliDeviceFlowCollaborators;
  userCode: string;
}): Promise<CliDeviceCodeRecord> {
  const record = await flow.sessions().getDeviceCodeByUserCode({
    userCode,
    unknownDescription: "Code not recognised",
  });

  if (expired(record)) throw refused("expired", "Code has expired", 410);

  if (record.status !== "pending") {
    throw refused(
      "already_resolved",
      `Code is in '${record.status}' state — restart langwatch login`,
      409,
    );
  }

  return record;
}

/** Refuses where the organization lacks governance, pointing it at project login instead. */
async function assertGovernanceEnabled({
  flow,
  person,
  organizationId,
}: {
  flow: CliDeviceFlowCollaborators;
  person: CliBrowserSession;
  organizationId: string;
}): Promise<void> {
  // Governance gate: provisioning a personal workspace/virtual key is a
  // governance-plane capability. Flag defaults ON, so this only fires for
  // organizations without it, pointing them at project login instead.
  const governanceTarget: FeatureFlagTarget = {
    kind: "organization",
    userId: person.id,
    userEmail: person.email ?? undefined,
    organizationId,
  };
  const governanceEnabled = await flow
    .featureFlags()
    .isEnabled(GOVERNANCE_RELEASE_FLAG, governanceTarget)
    .catch(() => true);

  if (!governanceEnabled) {
    throw refused(
      "governance_required",
      "AI-tools (device) login needs governance enabled for your organization. " +
        "Re-run `langwatch login` and choose project login. It writes a project API key to your .env.",
      403,
    );
  }
}

/**
 * The browser's approval. Approval proves identity and stamps the key
 * SELECTION — it still mints no credential, so an approval never exchanged
 * leaves no row.
 */
async function approve({
  flow,
  keys,
  raw,
  headers,
}: {
  flow: CliDeviceFlowCollaborators;
  keys: CliDeviceKeysService;
  raw: string;
  headers: Headers;
}): Promise<CliDeviceFlowAnswer> {
  const person = await flow.session(headers);

  if (!person) throw refused("unauthorized", "Sign in to continue", 401);

  const parsed = approveRequestSchema.safeParse(posted(raw));

  if (!parsed.success) {
    throw refused("invalid_request", "user_code and organization_id are required", 400);
  }

  const { user_code, organization_id, project_id } = parsed.data;

  // An operator acting as a member holds no grant to issue credentials as them (F05).
  if (person.impersonator) {
    throw new PermissionDeniedError({
      permission: "apiKeys:create",
      scope: { type: "organization", id: organization_id },
      denialReason: "no-binding",
    });
  }

  // Verify the caller is an ACTIVE member of the organization they are issuing
  // a credential for: a membership an admin disabled to reclaim its seat must
  // not approve a device and hand out a key it could not use.
  const isMember = await flow.directory().hasActiveMembership({
    userId: person.id,
    organizationId: organization_id,
  });

  if (!isMember) {
    throw refused("forbidden", `Not a member of organization ${organization_id}`, 403);
  }

  const record = await pendingRecordFor({ flow, userCode: user_code });

  // Branch on the credential type the CLI requested at /device-code time.
  // `project_api_key` binds the session to the picked project; it mints no key.
  if ((record.credential_type ?? "device_session") === "project_api_key") {
    return approveProject({ flow, record, person, organizationId: organization_id, project_id });
  }

  await assertGovernanceEnabled({ flow, person, organizationId: organization_id });

  const management =
    record.management === true
      ? await keys.managementPermissionsHeld({ person, organizationId: organization_id })
      : [];

  const keySelection = await keys.keySelectionFieldsFor({
    person,
    organizationId: organization_id,
    requested: parsed.data.key_selection,
    management,
  });

  await flow.sessions().approveDeviceCode({
    deviceCode: record.device_code,
    userId: person.id,
    organizationId: organization_id,
    ...keySelection,
  });

  return answer({ ok: true, organization_id });
}

/**
 * The picked project, stamped onto the record for `/exchange` to bind the
 * session to. The picker labels personal clearly, so an explicit self-pick is
 * honoured; another person's personal project is refused.
 */
async function approveProject({
  flow,
  record,
  person,
  organizationId,
  project_id,
}: {
  flow: CliDeviceFlowCollaborators;
  record: CliDeviceCodeRecord;
  person: CliBrowserSession;
  organizationId: string;
  project_id: string | undefined;
}): Promise<CliDeviceFlowAnswer> {
  if (!project_id) {
    throw refused(
      "invalid_request",
      "project_id is required when credential_type is project_api_key",
      400,
    );
  }

  // Resolve the picked project: it must live in the chosen organization and not
  // be archived. Authorization is the `project:view` check below, which inspects
  // project-, team- and org-scoped bindings; a spoofed `project_id` from another
  // organization finds nothing here.
  const project = await flow
    .directory()
    .getLiveProject({ projectId: project_id, organizationId })
    .catch((error: unknown) => {
      if (isProjectGone(error)) {
        throw refused("forbidden", "Project not found or unavailable in this organization", 403);
      }
      throw error;
    });

  if (project.isPersonal && project.ownerUserId !== person.id) {
    throw refused(
      "personal_project_not_allowed",
      "Another user's personal project can't back your session. Pick a shared team project, or your own personal workspace.",
      400,
    );
  }

  // A Developer seat (ADR-171) works in its own personal project only; naming the seat tells the
  // person what to pick instead of a role nobody can grant them.
  const ownsPersonalProject = project.isPersonal && project.ownerUserId === person.id;
  if (
    !ownsPersonalProject &&
    (await flow.directory().findActiveMemberRole({ userId: person.id, organizationId })) ===
      "DEVELOPER"
  ) {
    throw refused(
      "developer_seat_personal_only",
      "A Developer seat works in its own personal project only. Pick your personal workspace.",
      400,
    );
  }

  if (!(await flow.canViewProject({ userId: person.id, projectId: project.id }))) {
    throw refused("forbidden", "You do not have access to this project.", 403);
  }

  await flow.sessions().approveDeviceCode({
    deviceCode: record.device_code,
    userId: person.id,
    organizationId,
    project: {
      project_id: project.id,
      project_slug: project.slug,
      project_name: project.name,
    },
  });

  return answer({
    ok: true,
    kind: "api_key" as const,
    project: { id: project.id, slug: project.slug, name: project.name },
    organization_id: organizationId,
  });
}

/**
 * Ends a device session. Best-effort and idempotent: logout stays a 200
 * whatever state the key is in, and a failed revoke is logged rather than
 * surfaced — the key still dies with the owner's next re-login.
 */
async function logout({
  flow,
  raw,
}: {
  flow: CliDeviceFlowCollaborators;
  raw: string;
}): Promise<CliDeviceFlowAnswer> {
  const parsed = logoutRequestSchema.safeParse(posted(raw));

  // 200 either way — logout is idempotent, and a client that sent garbage must
  // not be told its sign-out failed. There is simply nothing to revoke.
  if (!parsed.success) return answer({ ok: true });

  const records = await flow.sessions().endSession({
    refreshToken: parsed.data.refresh_token,
    accessToken: parsed.data.access_token,
  });
  const seen = new Set<string>();

  for (const record of records) {
    const apiKeyId = record.cli_api_key_id;

    if (!apiKeyId || seen.has(apiKeyId)) continue;

    seen.add(apiKeyId);

    try {
      await flow.apiKeys().revokeCliLoginKeyForLogout({
        apiKeyId,
        userId: record.user_id,
        organizationId: record.organization_id,
      });
    } catch (err) {
      logger.warn(
        { err, apiKeyId, userId: record.user_id },
        "[auth-cli] failed to revoke the CLI key on logout",
      );
    }
  }

  return answer({ ok: true });
}

/** The browser side of the device grant: approving a code, and ending a session at logout. */
export class CliDeviceApproveService {
  static create({
    flow,
    keys,
  }: {
    flow: CliDeviceFlowCollaborators;
    keys: CliDeviceKeysService;
  }): CliDeviceApproveService {
    return new CliDeviceApproveService(flow, keys);
  }

  private constructor(
    private readonly flow: CliDeviceFlowCollaborators,
    private readonly keys: CliDeviceKeysService,
  ) {}

  approveDeviceCode(input: { raw: string; headers: Headers }): Promise<CliDeviceFlowAnswer> {
    return approve({ flow: this.flow, keys: this.keys, ...input });
  }

  endSession({ raw }: { raw: string }): Promise<CliDeviceFlowAnswer> {
    return logout({ flow: this.flow, raw });
  }
}
