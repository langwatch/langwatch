// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  governanceCliBudgetStatusAnswers,
  governanceCliBootstrapAnswers,
  governanceCliBudgetOverviewAnswers,
  governanceCliPersonalProjectAnswers,
  governanceCliVirtualKeyAnswers,
  governanceCliProjectKeyAnswers,
  governanceCliIngestionSourcesAnswers,
  governanceCliIngestionSourceEventsAnswers,
  governanceCliIngestionSourceHealthAnswers,
  governanceCliGovernanceStatusAnswers,
  governanceCliIngestionTemplatesAnswers,
  governanceCliIngestionKeyAnswers,
  governanceCliIngestionKeysAnswers,
  governanceCliIngestionKeyStateAnswers,
  governanceCliIngestionKeyRequestSchema,
  governanceCliProjectKeyRequestSchema,
  governanceCliRefusalAnswers,
  governanceCliVirtualKeyRequestSchema,
  type GovernanceApi,
  type GovernanceCliBudgetStatusAnswer,
  type GovernanceCliBootstrapAnswer,
  type GovernanceCliBudgetOverviewAnswer,
  type GovernanceCliPersonalProjectAnswer,
  type GovernanceCliVirtualKeyAnswer,
  type GovernanceCliProjectKeyAnswer,
  type GovernanceCliIngestionSourcesAnswer,
  type GovernanceCliIngestionSourceEventsAnswer,
  type GovernanceCliIngestionSourceHealthAnswer,
  type GovernanceCliGovernanceStatusAnswer,
  type GovernanceCliIngestionTemplatesAnswer,
  type GovernanceCliIngestionKeyAnswer,
  type GovernanceCliIngestionKeysAnswer,
  type GovernanceCliIngestionKeyStateAnswer,
  type GovernanceCliRefusalAnswer,
  type GovernanceCliIngestionKey,
  type GovernanceCliIngestionTemplate,
  type GovernanceCliKeyLookupRequest,
  type GovernanceCliRawRequest,
  type GovernanceCliRequest,
  type GovernanceCliSourceEventsRequest,
  type GovernanceCliSourceRequest,
  type GovernanceCliSourcesRequest,
} from "@langwatch/enterprise-governance-contract";
import { HandledError } from "@langwatch/handled-error";

import type {
  GovernanceCliAccessApi,
  GovernanceCliAdmission,
  GovernanceCliCaller,
  GovernanceCliEnterpriseFeature,
} from "./governance-cli-access.service.ts";
import type { GovernanceCliActivityApi } from "./governance-cli-activity.service.ts";
import type {
  GovernanceCliCredentialApi,
  GovernanceCliIngestionKeyOutcome,
} from "./governance-cli-credentials.service.ts";

type GovernanceCliServiceMembers = Readonly<{
  access: GovernanceCliAccessApi;
  credentials: GovernanceCliCredentialApi;
  activity: GovernanceCliActivityApi;
  governance: GovernanceApi;
}>;

export class GovernanceCliService {
  #access: GovernanceCliAccessApi;
  #credentials: GovernanceCliCredentialApi;
  #activity: GovernanceCliActivityApi;
  #governance: GovernanceApi;

  private constructor(members: GovernanceCliServiceMembers) {
    this.#access = members.access;
    this.#credentials = members.credentials;
    this.#activity = members.activity;
    this.#governance = members.governance;
  }

  static create(members: GovernanceCliServiceMembers): GovernanceCliService {
    return new GovernanceCliService(members);
  }

  async budgetStatus(input: GovernanceCliRequest): Promise<GovernanceCliBudgetStatusAnswer> {
    const gate = await this.#admit(input);
    if ("refusal" in gate) {
      if (gate.refusal.status === 402)
        throw new Error("budget status admits with no plan feature, so it never answers 402");
      return gate.refusal;
    }
    const status = await this.#credentials.budgetStatus(gate.caller);
    if (status.outcome === "clear") return ok(governanceCliBudgetStatusAnswers[200], { ok: true });
    return {
      status: 402,
      body: governanceCliBudgetStatusAnswers[402].parse({
        error: {
          type: "budget_exceeded",
          scope: status.scope,
          limit_usd: status.limitUsd,
          spent_usd: status.spentUsd,
          period: status.period,
          request_increase_url: status.requestIncreaseUrl,
          admin_email: status.adminEmail,
        },
      }),
    };
  }

  async bootstrap(input: GovernanceCliRequest): Promise<GovernanceCliBootstrapAnswer> {
    const gate = await this.#admit(input);
    if ("refusal" in gate) return gate.refusal;
    return ok(
      governanceCliBootstrapAnswers[200],
      await this.#governance.cliBootstrapResolve({
        userId: gate.caller.user_id,
        organizationId: gate.caller.organization_id,
      }),
    );
  }

  async budgetOverview(input: GovernanceCliRequest): Promise<GovernanceCliBudgetOverviewAnswer> {
    const gate = await this.#admit(input);
    if ("refusal" in gate) return gate.refusal;
    return ok(
      governanceCliBudgetOverviewAnswers[200],
      await this.#governance.personalBudgetOverviewForUser({
        userId: gate.caller.user_id,
        organizationId: gate.caller.organization_id,
      }),
    );
  }

  async personalProject(input: GovernanceCliRequest): Promise<GovernanceCliPersonalProjectAnswer> {
    const gate = await this.#admit({ ...input, requireActiveMembership: true });
    if ("refusal" in gate) return gate.refusal;
    const resolved = await this.#credentials.resolvePersonalProject(gate.caller);
    if (resolved.outcome === "failed")
      return refuse("server_error", "Could not resolve your personal project", 500);
    return ok(governanceCliPersonalProjectAnswers[200], {
      project: {
        id: resolved.project.id,
        slug: resolved.project.slug,
        name: resolved.project.name,
        api_key: resolved.project.apiKey,
      },
    });
  }

  async virtualKey(input: GovernanceCliRawRequest): Promise<GovernanceCliVirtualKeyAnswer> {
    const gate = await this.#admit({ ...input, requireActiveMembership: true });
    if ("refusal" in gate) return gate.refusal;
    const parsed = governanceCliVirtualKeyRequestSchema.safeParse(posted(input.raw));
    if (!parsed.success) return refuse("invalid_request", "device_label must be a string", 400);
    const issued = await this.#credentials.issuePersonalVirtualKey({
      caller: gate.caller,
      deviceLabel: parsed.data.device_label,
    });
    if (issued.outcome === "no-eligible-providers")
      return refuse(
        "no_eligible_providers",
        "Your organization has no AI providers configured for the gateway. Ask an admin to add one at Settings → Model Providers.",
        409,
      );
    if (issued.outcome === "failed")
      return refuse("server_error", "Could not issue a personal virtual key", 500);
    return created(governanceCliVirtualKeyAnswers[201], {
      id: issued.id,
      secret: issued.secret,
      prefix: issued.prefix,
    });
  }

  async projectKey(input: GovernanceCliRawRequest): Promise<GovernanceCliProjectKeyAnswer> {
    const gate = await this.#admit({ ...input, requireActiveMembership: true });
    if ("refusal" in gate) return gate.refusal;
    const parsed = governanceCliProjectKeyRequestSchema.safeParse(posted(input.raw));
    if (!parsed.success) return refuse("invalid_request", "slug is required", 400);
    const handout = await this.#credentials.handOutProjectKey({
      caller: gate.caller,
      slug: parsed.data.slug,
    });
    switch (handout.outcome) {
      case "project-not-found":
        return refuse(
          "not_found",
          `No project with slug "${handout.slug}" in your organization`,
          404,
        );
      case "personal-project-not-allowed":
        return refuse(
          "personal_project_not_allowed",
          "Another user's personal project can't back your API key. Pick a shared team project, or your own personal workspace.",
          400,
        );
      case "forbidden":
        return refuse(
          "forbidden",
          "You need write access to this project to retrieve its API key.",
          403,
        );
      case "granted":
        return ok(governanceCliProjectKeyAnswers[200], {
          api_key: handout.apiKey,
          project: handout.project,
        });
    }
  }

  async ingestionSources(
    input: GovernanceCliSourcesRequest,
  ): Promise<GovernanceCliIngestionSourcesAnswer> {
    const gate = await this.#admit({
      ...input,
      feature: "ingestionSources",
      permission: "ingestionSources:view",
    });
    if ("refusal" in gate) return gate.refusal;
    const sources = await this.#activity.sources({
      organizationId: gate.caller.organization_id,
      includeArchived: input.includeArchived,
    });
    return ok(governanceCliIngestionSourcesAnswers[200], {
      sources: sources.map((source) => ({
        id: source.id,
        name: source.name,
        sourceType: source.sourceType,
        description: source.description,
        status: source.status,
        lastEventAt: source.lastEventAt?.toISOString() ?? null,
        createdAt: source.createdAt.toISOString(),
        archivedAt: source.archivedAt?.toISOString() ?? null,
      })),
    });
  }

  async ingestionSourceEvents(
    input: GovernanceCliSourceEventsRequest,
  ): Promise<GovernanceCliIngestionSourceEventsAnswer> {
    const gate = await this.#admit({
      ...input,
      feature: "activityMonitor",
      permission: "activityMonitor:view",
    });
    if ("refusal" in gate) return gate.refusal;
    return ok(governanceCliIngestionSourceEventsAnswers[200], {
      events: await this.#activity.eventsForSource({
        organizationId: gate.caller.organization_id,
        sourceId: input.sourceId,
        limit: input.limit,
        beforeIso: input.beforeIso,
      }),
    });
  }

  async ingestionSourceHealth(
    input: GovernanceCliSourceRequest,
  ): Promise<GovernanceCliIngestionSourceHealthAnswer> {
    const gate = await this.#admit({
      ...input,
      feature: "ingestionSources",
      permission: "activityMonitor:view",
    });
    if ("refusal" in gate) return gate.refusal;
    return ok(
      governanceCliIngestionSourceHealthAnswers[200],
      await this.#activity.healthForSource({
        organizationId: gate.caller.organization_id,
        sourceId: input.sourceId,
      }),
    );
  }

  async governanceStatus(
    input: GovernanceCliRequest,
  ): Promise<GovernanceCliGovernanceStatusAnswer> {
    const gate = await this.#admit({ ...input, feature: "ingestionSources" });
    if ("refusal" in gate) return gate.refusal;
    return ok(governanceCliGovernanceStatusAnswers[200], {
      setup: await this.#governance.resolveSetupState(gate.caller.organization_id),
    });
  }

  async ingestionTemplates(
    input: GovernanceCliRequest,
  ): Promise<GovernanceCliIngestionTemplatesAnswer> {
    const gate = await this.#admit(input);
    if ("refusal" in gate) return gate.refusal;
    const rows = await this.#governance.templateListForUser({
      organizationId: gate.caller.organization_id,
    });
    return ok(governanceCliIngestionTemplatesAnswers[200], {
      ingestion_templates: rows.map(toTemplate),
    });
  }

  async ingestionKey(input: GovernanceCliRawRequest): Promise<GovernanceCliIngestionKeyAnswer> {
    const gate = await this.#admit({ ...input, requireActiveMembership: true });
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
    const gate = await this.#admit(input);
    if ("refusal" in gate) return gate.refusal;
    const keys = await this.#governance.ingestionKeyListForPersonalProject({
      userId: gate.caller.user_id,
      organizationId: gate.caller.organization_id,
    });
    return ok(governanceCliIngestionKeysAnswers[200], { keys: keys.map(toIngestionKey) });
  }

  async ingestionKeyState(
    input: GovernanceCliKeyLookupRequest,
  ): Promise<GovernanceCliIngestionKeyStateAnswer> {
    const gate = await this.#admit(input);
    if ("refusal" in gate) return gate.refusal;
    const key = await this.#governance
      .getPersonalIngestionKeyState({
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

  async #admit(
    input: GovernanceCliRequest &
      Readonly<{
        feature?: GovernanceCliEnterpriseFeature;
        permission?: AuthzPermission;
        requireActiveMembership?: boolean;
      }>,
  ): Promise<{ caller: GovernanceCliCaller } | { refusal: GovernanceCliGateRefusal }> {
    return admissionResult(await this.#access.admit(input));
  }
}

type GovernanceCliGateRefusal = Extract<GovernanceCliRefusalAnswer, { status: 401 | 402 | 403 }>;

function ok<Body>(
  schema: { parse(body: unknown): Body },
  body: unknown,
): { status: 200; body: Body } {
  return { status: 200, body: schema.parse(body) };
}
function created<Body>(
  schema: { parse(body: unknown): Body },
  body: unknown,
): { status: 201; body: Body } {
  return { status: 201, body: schema.parse(body) };
}
function refuse<Status extends GovernanceCliRefusalAnswer["status"]>(
  error: string,
  error_description: string,
  status: Status,
): { status: Status; body: GovernanceCliRefusalAnswer["body"] } {
  return {
    status,
    body: governanceCliRefusalAnswers[status].parse({ error, error_description }),
  };
}
function posted(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
}
function admissionResult(
  result: GovernanceCliAdmission,
): { caller: GovernanceCliCaller } | { refusal: GovernanceCliGateRefusal } {
  switch (result.outcome) {
    case "admitted":
      return { caller: result.caller };
    case "unauthorized":
      return {
        refusal: refuse(
          "unauthorized",
          "Bearer access token is missing, malformed, or expired",
          401,
        ),
      };
    case "membership-ended":
      return {
        refusal: refuse(
          "forbidden",
          "Your access to this organization has ended. Run `langwatch login` to sign in again.",
          403,
        ),
      };
    case "payment-required":
      return {
        refusal: {
          status: 402,
          body: governanceCliRefusalAnswers[402].parse({
            error: "payment_required",
            error_description: result.errorMessage,
            upgrade_url: result.upgradeUrl,
          }),
        },
      };
    case "forbidden":
      return {
        refusal: refuse(
          "forbidden",
          `Missing required permission '${result.permission}' on this organization`,
          403,
        ),
      };
  }
}
function toTemplate(row: {
  id: string;
  organizationId: string | null;
  slug: string;
  sourceType: string;
  displayName: string;
  description: string | null;
  iconAsset: string | null;
  credentialSchema: string | null;
  ottlRules: string;
  platformPublished: boolean;
  enabled: boolean;
}): GovernanceCliIngestionTemplate {
  return {
    id: row.id,
    organization_id: row.organizationId,
    slug: row.slug,
    source_type: row.sourceType,
    display_name: row.displayName,
    description: row.description,
    icon_asset: row.iconAsset,
    credential_schema: row.credentialSchema,
    ottl_rules: row.ottlRules,
    platform_published: row.platformPublished,
    enabled: row.enabled,
  };
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
        `Your organization does not allow ${outcome.toolSlug} to send telemetry directly. Run \`langwatch ${outcome.toolSlug}\`, which routes through the gateway.`,
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
