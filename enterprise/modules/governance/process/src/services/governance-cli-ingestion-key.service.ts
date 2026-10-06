import {
  governanceCliIngestionKeyAnswers,
  governanceCliIngestionKeysAnswers,
  governanceCliIngestionKeyStateAnswers,
  governanceCliIngestionKeyRequestSchema,
  type GovernanceCliIngestionKey,
  type GovernanceCliIngestionKeyAnswer,
  type GovernanceCliIngestionKeysAnswer,
  type GovernanceCliIngestionKeyStateAnswer,
  type GovernanceCliKeyLookupRequest,
  type GovernanceCliRawRequest,
  type GovernanceCliRequest,
} from "@langwatch/enterprise-governance-contract";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { HandledError } from "@langwatch/handled-error";

import { created, ok, posted, refuse } from "../rules/governance-cli-answer.rules.ts";
import type { GovernanceCliCredentialApi } from "./governance-cli-credentials.service.ts";
import { type GovernanceCliGateService } from "./governance-cli-gate.service.ts";
import type { GovernanceCliIngestionKeyOutcome } from "./governance-cli-ingestion-key-mint.service.ts";
import type { PersonalIngestionKeyService } from "./personal-ingestion-key.service.ts";

type GovernanceCliIngestionKeyMembers = Readonly<{
  gate: GovernanceCliGateService;
  credentials: GovernanceCliCredentialApi;
  ingestionKeys: Pick<PersonalIngestionKeyService, "list" | "getPersonalKeyState">;
}>;

/** The CLI's ingestion-key routes: mint one, list the caller's own, read one key's state. */
export class GovernanceCliIngestionKeyService {
  #gate: GovernanceCliGateService;
  #credentials: GovernanceCliCredentialApi;
  #ingestionKeys: GovernanceCliIngestionKeyMembers["ingestionKeys"];

  private constructor(members: GovernanceCliIngestionKeyMembers) {
    this.#gate = members.gate;
    this.#credentials = members.credentials;
    this.#ingestionKeys = members.ingestionKeys;
  }

  static create(members: GovernanceCliIngestionKeyMembers): GovernanceCliIngestionKeyService {
    return new GovernanceCliIngestionKeyService(members);
  }

  async ingestionKey(input: GovernanceCliRawRequest): Promise<GovernanceCliIngestionKeyAnswer> {
    const gate = await this.#gate.admit({ ...input, requireActiveMembership: true });
    if ("refusal" in gate) return gate.refusal;
    const parsed = governanceCliIngestionKeyRequestSchema.safeParse(posted(input.raw));
    if (!parsed.success) return refuse("invalid_request", parsed.error.message, 400);
    return renderIngestionKey(
      await this.#credentials.mintIngestionKey({
        caller: gate.caller,
        sourceType: parsed.data.source_type,
        projectRef: parsed.data.project,
        deviceLabel: parsed.data.device_label,
      }),
    );
  }

  async ingestionKeys(input: GovernanceCliRequest): Promise<GovernanceCliIngestionKeysAnswer> {
    const gate = await this.#gate.admit(input);
    if ("refusal" in gate) return gate.refusal;
    const keys = await this.#ingestionKeys.list({
      userId: gate.caller.user_id,
      organizationId: gate.caller.organization_id,
    });
    return ok(governanceCliIngestionKeysAnswers[200], { keys: keys.map(toIngestionKey) });
  }

  async ingestionKeyState(
    input: GovernanceCliKeyLookupRequest,
  ): Promise<GovernanceCliIngestionKeyStateAnswer> {
    const gate = await this.#gate.admit(input);
    if ("refusal" in gate) return gate.refusal;
    const key = await this.#ingestionKeys
      .getPersonalKeyState({
        userId: gate.caller.user_id,
        organizationId: gate.caller.organization_id,
        lookupId: input.lookupId,
      })
      .catch((error: unknown) => {
        if (HandledError.isHandled(error) && error.code === "ingestion_key_not_found") return null;
        throw error;
      });
    if (!key)
      return ok(governanceCliIngestionKeyStateAnswers[200], {
        lookup_id: input.lookupId,
        status: "unknown",
      });
    return ok(governanceCliIngestionKeyStateAnswers[200], {
      lookup_id: input.lookupId,
      status: key.live ? "live" : "revoked",
      source_type: key.sourceType,
      revocation_cause: key.revocationCause,
    });
  }
}

function toIngestionKey(row: {
  sourceType: string;
  lookupId: string;
  ingestionTemplateId: string | null;
}): GovernanceCliIngestionKey {
  return {
    source_type: row.sourceType,
    lookup_id: row.lookupId,
    ingestion_template_id: row.ingestionTemplateId,
  };
}
function renderIngestionKey(
  outcome: GovernanceCliIngestionKeyOutcome,
): GovernanceCliIngestionKeyAnswer {
  switch (outcome.outcome) {
    case "minted":
      return created(governanceCliIngestionKeyAnswers[201], {
        token: outcome.token,
        prefix: outcome.prefix,
        endpoint: outcome.endpoint,
        ...(outcome.project ? { project: outcome.project } : {}),
      });
    case "direct-otel-not-allowed":
      return refuse(
        "direct_otel_not_allowed",
        `Your organization does not allow ${outcome.toolSlug} to send telemetry directly. Run \`langwatch ${outcome.toolSlug}\`, ` +
          `which routes through the gateway.`,
        403,
      );
    case "project-not-found":
      return refuse(
        "project_not_found",
        `No project "${outcome.projectRef}" in your organization`,
        404,
      );
    case "personal-project-not-allowed":
      return refuse(
        "personal_project_not_allowed",
        "Another user's personal project can't receive your ingestion key. Pick a shared team project, or your own personal workspace.",
        400,
      );
    case "forbidden":
      return refuse(
        "forbidden",
        "You need permission to write traces into this project to mint an ingestion key for it.",
        403,
      );
    case "source-type-not-personal":
      return refuse(
        "invalid_request",
        `No personal ingestion key is minted for source type ${outcome.sourceType}. Personal keys are minted for the tools the LangWatch CLI wraps.`,
        400,
      );
    case "personal-workspace-missing":
      return refuse(
        "precondition_failed",
        "Sign in to a personal workspace before issuing an ingestion key.",
        412,
      );
    case "session-signed-out":
      return refuse(
        "unauthorized",
        "This device session is signed out. Run `langwatch login` to start a new session.",
        401,
      );
    case "failed":
      return refuse("server_error", "Could not mint an ingestion key", 500);
  }
}
