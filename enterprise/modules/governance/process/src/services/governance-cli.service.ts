// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  governanceCliBudgetStatusAnswers,
  governanceCliBootstrapAnswers,
  governanceCliBudgetOverviewAnswers,
  governanceCliPersonalProjectAnswers,
  governanceCliVirtualKeyAnswers,
  governanceCliIngestionSourcesAnswers,
  governanceCliIngestionSourceEventsAnswers,
  governanceCliIngestionSourceHealthAnswers,
  governanceCliGovernanceStatusAnswers,
  governanceCliIngestionTemplatesAnswers,
  governanceCliVirtualKeyRequestSchema,
  type GovernanceCliBudgetStatusAnswer,
  type GovernanceCliBootstrapAnswer,
  type GovernanceCliBudgetOverviewAnswer,
  type GovernanceCliPersonalProjectAnswer,
  type GovernanceCliVirtualKeyAnswer,
  type GovernanceCliIngestionSourcesAnswer,
  type GovernanceCliIngestionSourceEventsAnswer,
  type GovernanceCliIngestionSourceHealthAnswer,
  type GovernanceCliGovernanceStatusAnswer,
  type GovernanceCliIngestionTemplatesAnswer,
  type GovernanceCliIngestionKeyAnswer,
  type GovernanceCliIngestionKeysAnswer,
  type GovernanceCliIngestionKeyStateAnswer,
  type GovernanceCliIngestionTemplate,
  type GovernanceCliKeyLookupRequest,
  type GovernanceCliRawRequest,
  type GovernanceCliRequest,
  type GovernanceCliSourceEventsRequest,
  type GovernanceCliSourceRequest,
  type GovernanceCliSourcesRequest,
} from "@langwatch/enterprise-governance-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";

import {
  created,
  ok,
  posted,
  refuse,
  refuseAbsentSource,
} from "../rules/governance-cli-answer.rules.ts";
import type { GovernanceCliAccessApi } from "./governance-cli-access.service.ts";
import type { GovernanceCliActivityApi } from "./governance-cli-activity.service.ts";
import type { GovernanceCliCredentialApi } from "./governance-cli-credentials.service.ts";
import { GovernanceCliGateService } from "./governance-cli-gate.service.ts";
import { GovernanceCliIngestionKeyService } from "./governance-cli-ingestion-key.service.ts";
import type { DefaultGovernanceCliBootstrapService } from "./governance-cli-tool-bootstrap.service.ts";
import type { DefaultGovernanceSetupStateService } from "./governance-setup-state.service.ts";
import type { IngestionTemplateService } from "./ingestion-template.service.ts";
import type { PersonalIngestionKeyService } from "./personal-ingestion-key.service.ts";

type GovernanceCliServiceMembers = Readonly<{
  access: GovernanceCliAccessApi;
  credentials: GovernanceCliCredentialApi;
  activity: GovernanceCliActivityApi;
  bootstraps: Pick<DefaultGovernanceCliBootstrapService, "resolve">;
  budgets: Pick<GatewayApi, "budgetOverviewForUser">;
  setupState: Pick<DefaultGovernanceSetupStateService, "resolve">;
  templates: Pick<IngestionTemplateService, "listForUser">;
  ingestionKeys: Pick<PersonalIngestionKeyService, "list" | "getPersonalKeyState">;
}>;

export class GovernanceCliService {
  #gate: GovernanceCliGateService;
  #keys: GovernanceCliIngestionKeyService;
  #credentials: GovernanceCliCredentialApi;
  #activity: GovernanceCliActivityApi;
  #bootstraps: GovernanceCliServiceMembers["bootstraps"];
  #budgets: GovernanceCliServiceMembers["budgets"];
  #setupState: GovernanceCliServiceMembers["setupState"];
  #templates: GovernanceCliServiceMembers["templates"];

  private constructor(members: GovernanceCliServiceMembers) {
    this.#gate = GovernanceCliGateService.create({ access: members.access });
    this.#keys = GovernanceCliIngestionKeyService.create({
      gate: this.#gate,
      credentials: members.credentials,
      ingestionKeys: members.ingestionKeys,
    });
    this.#credentials = members.credentials;
    this.#activity = members.activity;
    this.#bootstraps = members.bootstraps;
    this.#budgets = members.budgets;
    this.#setupState = members.setupState;
    this.#templates = members.templates;
  }

  static create(members: GovernanceCliServiceMembers): GovernanceCliService {
    return new GovernanceCliService(members);
  }

  async budgetStatus(input: GovernanceCliRequest): Promise<GovernanceCliBudgetStatusAnswer> {
    const gate = await this.#gate.admit(input);
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
    const gate = await this.#gate.admit(input);
    if ("refusal" in gate) return gate.refusal;
    return ok(
      governanceCliBootstrapAnswers[200],
      await this.#bootstraps.resolve({
        userId: gate.caller.user_id,
        organizationId: gate.caller.organization_id,
      }),
    );
  }

  async budgetOverview(input: GovernanceCliRequest): Promise<GovernanceCliBudgetOverviewAnswer> {
    const gate = await this.#gate.admit(input);
    if ("refusal" in gate) return gate.refusal;
    return ok(
      governanceCliBudgetOverviewAnswers[200],
      await this.#budgets.budgetOverviewForUser({
        userId: gate.caller.user_id,
        organizationId: gate.caller.organization_id,
      }),
    );
  }

  async personalProject(input: GovernanceCliRequest): Promise<GovernanceCliPersonalProjectAnswer> {
    const gate = await this.#gate.admit({ ...input, requireActiveMembership: true });
    if ("refusal" in gate) return gate.refusal;
    const resolved = await this.#credentials.resolvePersonalProject(gate.caller);
    if (resolved.outcome === "failed")
      return refuse("server_error", "Could not resolve your personal project", 500);
    return ok(governanceCliPersonalProjectAnswers[200], {
      project: {
        id: resolved.project.id,
        slug: resolved.project.slug,
        name: resolved.project.name,
      },
    });
  }

  async virtualKey(input: GovernanceCliRawRequest): Promise<GovernanceCliVirtualKeyAnswer> {
    const gate = await this.#gate.admit({ ...input, requireActiveMembership: true });
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

  async ingestionSources(
    input: GovernanceCliSourcesRequest,
  ): Promise<GovernanceCliIngestionSourcesAnswer> {
    const gate = await this.#gate.admit({
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
    const gate = await this.#gate.admit({
      ...input,
      feature: "activityMonitor",
      permission: "activityMonitor:view",
    });
    if ("refusal" in gate) return gate.refusal;
    try {
      const events = await this.#activity.eventsForSource({
        organizationId: gate.caller.organization_id,
        sourceId: input.sourceId,
        limit: input.limit,
        beforeIso: input.beforeIso,
      });
      return ok(governanceCliIngestionSourceEventsAnswers[200], { events });
    } catch (error) {
      return refuseAbsentSource(error);
    }
  }

  async ingestionSourceHealth(
    input: GovernanceCliSourceRequest,
  ): Promise<GovernanceCliIngestionSourceHealthAnswer> {
    const gate = await this.#gate.admit({
      ...input,
      feature: "ingestionSources",
      permission: "activityMonitor:view",
    });
    if ("refusal" in gate) return gate.refusal;
    try {
      const health = await this.#activity.healthForSource({
        organizationId: gate.caller.organization_id,
        sourceId: input.sourceId,
      });
      return ok(governanceCliIngestionSourceHealthAnswers[200], health);
    } catch (error) {
      return refuseAbsentSource(error);
    }
  }

  async governanceStatus(
    input: GovernanceCliRequest,
  ): Promise<GovernanceCliGovernanceStatusAnswer> {
    const gate = await this.#gate.admit({ ...input, feature: "ingestionSources" });
    if ("refusal" in gate) return gate.refusal;
    return ok(governanceCliGovernanceStatusAnswers[200], {
      setup: await this.#setupState.resolve(gate.caller.organization_id),
    });
  }

  async ingestionTemplates(
    input: GovernanceCliRequest,
  ): Promise<GovernanceCliIngestionTemplatesAnswer> {
    const gate = await this.#gate.admit(input);
    if ("refusal" in gate) return gate.refusal;
    const rows = await this.#templates.listForUser({
      organizationId: gate.caller.organization_id,
    });
    return ok(governanceCliIngestionTemplatesAnswers[200], {
      ingestion_templates: rows.map(toTemplate),
    });
  }

  ingestionKey(input: GovernanceCliRawRequest): Promise<GovernanceCliIngestionKeyAnswer> {
    return this.#keys.ingestionKey(input);
  }

  ingestionKeys(input: GovernanceCliRequest): Promise<GovernanceCliIngestionKeysAnswer> {
    return this.#keys.ingestionKeys(input);
  }

  ingestionKeyState(
    input: GovernanceCliKeyLookupRequest,
  ): Promise<GovernanceCliIngestionKeyStateAnswer> {
    return this.#keys.ingestionKeyState(input);
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
