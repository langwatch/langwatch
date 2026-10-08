/**
 * The CLI key a device session carries: what is minted, what it may reach, and the
 * personal workspace it names.
 * @see specs/ai-gateway/governance/cli-login.feature
 */

import {
  ApiKeyScopeViolationError,
  cliKeyManagementPermissions,
  type CliKeyScopeSummary,
  type CliKeySelection,
} from "@langwatch/api-key-contract";
import {
  CliDeviceFlowRefusedError,
  type approveRequestSchema,
  type clientInfoSchema,
} from "@langwatch/auth-contract";
import { createLogger } from "@langwatch/observability";
import type { z } from "zod";

import { normalizeDeviceLabel, withManagement } from "../rules/cli-device-flow.rules.ts";
import type { CliBrowserSession, CliDeviceFlowCollaborators } from "./cli-device-flow.service.ts";
import { type CliDeviceCodeRecord } from "./cli-device-session.service.ts";

const logger = createLogger("langwatch:auth-cli");

/** One OAuth refusal, in the two-field shape RFC 8628 clients parse. */
function refused(error: string, description: string, status: number): CliDeviceFlowRefusedError {
  return new CliDeviceFlowRefusedError({
    refusal: { error, error_description: description },
    httpStatus: status,
  });
}

const CLI_LOGIN_UNKNOWN_DEVICE_LABEL = "unknown-device";

/** What one exchange minted; nothing when the approval stamped no selection. */
type MintedCliKey = Readonly<{
  token?: string;
  apiKeyId?: string;
  scope?: Readonly<{
    kind: "organization" | "projects";
    project_ids: string[];
    permissions: string[];
  }>;
}>;

/**
 * The user-scoped CLI key, from the selection the approval stamped, so an
 * approval never exchanged mints nothing. Minted BEFORE the session tokens:
 * a mint failure fails the exchange rather than half-logging the CLI in.
 */
async function mintCliKey({
  flow,
  record,
  user,
  organization,
  clientInfo,
  sessionStartedAtMs,
}: {
  flow: CliDeviceFlowCollaborators;
  record: CliDeviceCodeRecord;
  user: Readonly<{ id: string }>;
  organization: Readonly<{ id: string }>;
  clientInfo: z.output<typeof clientInfoSchema>;
  sessionStartedAtMs: number;
}): Promise<MintedCliKey> {
  if (!record.key_selection) return {};

  // The same normalization every other label path uses, and the user-chosen
  // label wins over the machine hostname. The value names the key AND matches
  // the previous login key for replacement, so an unnormalized value would
  // leave the old key alive on a hostname or formatting change and let
  // credentials accumulate.
  const deviceLabel =
    normalizeDeviceLabel(clientInfo?.device_label ?? clientInfo?.hostname) ??
    CLI_LOGIN_UNKNOWN_DEVICE_LABEL;
  let minted: { token: string; apiKeyId: string; scope: CliKeyScopeSummary };

  try {
    minted = await flow.apiKeys().mintCliLoginKey({
      userId: user.id,
      organizationId: organization.id,
      deviceLabel,
      selection: record.key_selection,
      sessionStartedAtMs,
      maxSessionDurationDays: await flow.directory().maxSessionDurationDays(organization.id),
      refreshWindowMs: flow.sessions().refreshTokenTtlSeconds * 1000,
    });
  } catch (err) {
    // A ceiling refusal is permanent — the approver has since lost access — so
    // leaving the record approved means an endless "keep polling" loop. Burn
    // the device code and answer with the one code the CLI treats as fatal.
    if (ApiKeyScopeViolationError.is(err)) {
      logger.warn(
        { err, userId: user.id, organizationId: organization.id },
        "[auth-cli] CLI login key refused at exchange; terminating the device code",
      );
      await flow.sessions().consumeDeviceCode({ record });
      // Nothing was handed out, so the claim goes back rather than blocking
      // the CLI's next poll for half a minute.
      await flow.sessions().releaseExchangeClaim(record.device_code);

      throw refused(
        "access_denied",
        "Your access changed after you approved this login. Run `langwatch login` again.",
        410,
      );
    }

    throw err;
  }

  return {
    token: minted.token,
    apiKeyId: minted.apiKeyId,
    scope: {
      kind: minted.scope.kind,
      project_ids: minted.scope.projectIds,
      permissions: minted.scope.permissions,
    },
  };
}

/**
 * The personal project a device session names: a normal project, ensured here
 * (idempotent), never its key. Best-effort — a workspace
 * failure must not fail the login, and older CLIs ignore the field.
 */
async function personalProjectFieldsOf({
  flow,
  user,
  organization,
}: {
  flow: CliDeviceFlowCollaborators;
  user: Readonly<{ id: string; name?: string | null; email?: string | null }>;
  organization: Readonly<{ id: string }>;
}): Promise<
  Readonly<{
    personal_project?: Readonly<{ id: string; slug: string; name: string }>;
  }>
> {
  try {
    const ensured = await flow.ensurePersonalWorkspace({
      organizationId: organization.id,
      userId: user.id,
      displayName: user.name,
      displayEmail: user.email,
    });
    if (ensured.kind === "pending") return {};
    const { id, slug, name } = ensured.workspace.project;

    return { personal_project: { id, slug, name } };
  } catch (err) {
    logger.error(
      { err, userId: user.id, organizationId: organization.id },
      "[auth-cli] could not ensure personal workspace on exchange; device session ships without personal_project",
    );

    return {};
  }
}

/**
 * The selection an approval stamps. An explicit one is validated against the
 * registry and the approver's own ceiling; a violation throws and stamps
 * nothing. A legacy client with none gets the default, best-effort.
 */
async function keySelectionFieldsFor({
  flow,
  person,
  organizationId,
  requested,
  management,
}: {
  flow: CliDeviceFlowCollaborators;
  person: CliBrowserSession;
  organizationId: string;
  requested: z.output<typeof approveRequestSchema>["key_selection"];
  /** The management permissions to add: the ones the approver holds, when the CLI asked. */
  management: readonly string[];
}): Promise<Readonly<{ keySelection?: CliKeySelection }>> {
  if (requested) {
    // Management permissions are organization-wide: a key bound only to teams
    // or projects cannot carry them, and dropping them quietly would leave the
    // CLI refused on its first management command.
    if (
      management.length > 0 &&
      !requested.bindings.some((binding) => binding.scope_type === "ORGANIZATION")
    ) {
      throw managementNeedsOrganization();
    }

    const keySelection = await flow.apiKeys().validateCliSelection({
      userId: person.id,
      organizationId,
      selection: {
        bindings: requested.bindings.map((binding) => ({
          scopeType: binding.scope_type,
          scopeId: binding.scope_id,
        })),
        permissions: withManagement(requested.permissions, management),
      },
    });

    return { keySelection };
  }

  // The personal workspace is ensured first so its team can be part of the
  // default reach — idempotent, and not a credential.
  try {
    await flow.ensurePersonalWorkspace({
      organizationId,
      userId: person.id,
      displayName: person.name,
      displayEmail: person.email,
    });
  } catch (err) {
    logger.warn(
      { err, userId: person.id, organizationId },
      "[auth-cli] could not ensure personal workspace at approve; default key selection proceeds without it",
    );
  }

  const [keySelection] = await findDefaultKeySelections({ flow, person, organizationId });
  if (!keySelection || management.length === 0) return keySelection ? { keySelection } : {};

  if (!keySelection.bindings.some((binding) => binding.scopeType === "ORGANIZATION")) {
    throw managementNeedsOrganization();
  }

  return {
    keySelection: {
      ...keySelection,
      permissions: withManagement(keySelection.permissions, management).toSorted(),
    },
  };
}

/** The key a CLI login gets when the approval names none; empty when it cannot be resolved. */
async function findDefaultKeySelections({
  flow,
  person,
  organizationId,
}: {
  flow: CliDeviceFlowCollaborators;
  person: CliBrowserSession;
  organizationId: string;
}): Promise<CliKeySelection[]> {
  try {
    const keySelection = await flow
      .apiKeys()
      .findDefaultCliSelection({ userId: person.id, organizationId });
    return keySelection ? [keySelection] : [];
  } catch (err) {
    logger.warn(
      { err, userId: person.id, organizationId },
      "[auth-cli] could not resolve the default key selection; device session proceeds without a scoped key",
    );

    return [];
  }
}

/**
 * The management permissions the approver holds in the organization, asked one
 * at a time against their own ceiling. Holding none refuses `--management` by
 * name before anything is stamped.
 */
async function managementPermissionsHeld({
  flow,
  person,
  organizationId,
}: {
  flow: CliDeviceFlowCollaborators;
  person: CliBrowserSession;
  organizationId: string;
}): Promise<string[]> {
  const held: string[] = [];
  for (const permission of cliKeyManagementPermissions()) {
    try {
      await flow.apiKeys().validateCliSelection({
        userId: person.id,
        organizationId,
        selection: {
          bindings: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
          permissions: [permission],
        },
      });
      held.push(permission);
    } catch (error) {
      if (!(error instanceof ApiKeyScopeViolationError)) throw error;
    }
  }
  if (held.length > 0) return held;

  throw refused(
    "management_not_permitted",
    "You hold no management permission in this organization, so the CLI key cannot include " +
      "management access. Ask an organization admin, or run `langwatch login --device` without --management.",
    403,
  );
}

function managementNeedsOrganization(): CliDeviceFlowRefusedError {
  return refused(
    "management_needs_organization",
    "Management access applies to the whole organization. Select the organization as the key's access, or run `langwatch login --device` without --management.",
    400,
  );
}

type WithoutFlow<Input> = Omit<Input, "flow">;

/** The CLI key a device session carries: what is minted, what it may reach, and where it sits. */
export class CliDeviceKeysService {
  static create({ flow }: { flow: CliDeviceFlowCollaborators }): CliDeviceKeysService {
    return new CliDeviceKeysService(flow);
  }

  private constructor(private readonly flow: CliDeviceFlowCollaborators) {}

  mintCliKey(input: WithoutFlow<Parameters<typeof mintCliKey>[0]>): Promise<MintedCliKey> {
    return mintCliKey({ flow: this.flow, ...input });
  }

  personalProjectFieldsOf(
    input: WithoutFlow<Parameters<typeof personalProjectFieldsOf>[0]>,
  ): ReturnType<typeof personalProjectFieldsOf> {
    return personalProjectFieldsOf({ flow: this.flow, ...input });
  }

  keySelectionFieldsFor(
    input: WithoutFlow<Parameters<typeof keySelectionFieldsFor>[0]>,
  ): ReturnType<typeof keySelectionFieldsFor> {
    return keySelectionFieldsFor({ flow: this.flow, ...input });
  }

  managementPermissionsHeld(
    input: WithoutFlow<Parameters<typeof managementPermissionsHeld>[0]>,
  ): ReturnType<typeof managementPermissionsHeld> {
    return managementPermissionsHeld({ flow: this.flow, ...input });
  }
}
