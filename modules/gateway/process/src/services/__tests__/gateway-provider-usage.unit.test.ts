/**
 * A call LangWatch made with an organization's stored provider credentials is rated against the
 * model registry and lands on the spine attributed to its project, team, organization and
 * provider row, so the debit writer charges every budget it falls under (ADR-193).
 */
import type { GatewayProviderUsage, SpendUsage } from "@langwatch/gateway-contract";
import type { ModelProviderApi, ModelProviderExecution } from "@langwatch/model-provider-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import {
  GatewayInternalProtocolService,
  type GatewayInternalProtocolMembers,
  type GatewayInternalSpendPipeline,
} from "../gateway-internal-protocol.service.ts";

const EMBEDDINGS: GatewayProviderUsage = {
  requestId: "topic_clustering:run-1:0",
  projectId: "project-1",
  model: "openai/text-embedding-3-large",
  modelProviderId: "mp_openai",
  requestType: "topic_clustering",
  usage: { input_tokens: 1_000_000 },
  durationMs: 840,
  occurredAt: 1_762_128_000_000,
};

/** A stored OpenAI row as the provider directory answers it; only the id matters here. */
function executionRow(id: string): ModelProviderExecution {
  return {
    id,
    organizationId: "org-1",
    provider: "openai",
    name: "OpenAI",
    enabled: true,
    routingHandle: null,
    scopes: [],
    customKeys: null,
    customModels: [],
    customEmbeddingsModels: [],
    extraHeaders: [],
    rateLimitRpm: null,
    rateLimitTpm: null,
    rateLimitRpd: null,
    fallbackPriorityGlobal: null,
    providerConfig: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    models: null,
    embeddingsModels: null,
    isSystem: false,
    embeddingsUnsupported: false,
  };
}

const PROJECT = { id: "project-1", team: { id: "team-1", organizationId: "org-1" } };

function suppliedMembers(
  members: Partial<GatewayInternalProtocolMembers>,
): GatewayInternalProtocolMembers {
  return new Proxy(members as GatewayInternalProtocolMembers, {
    get(target, property) {
      if (property in target) return Reflect.get(target, property);
      throw new Error(`recordProviderUsage reached "${String(property)}", not supplied`);
    },
  });
}

function serviceOver({
  withPipeline = true,
  project = PROJECT,
  servingRowId = "mp_serving",
}: {
  withPipeline?: boolean;
  project?: typeof PROJECT | null;
  servingRowId?: string | null;
} = {}) {
  const sent: Record<string, unknown>[] = [];
  const rated: { model: string; usage: SpendUsage }[] = [];
  const spend: GatewayInternalSpendPipeline = {
    commands: {
      confirmSpend: {
        send: async (payload) => {
          sent.push({ ...(payload as Record<string, unknown>) });
        },
      },
    },
    rating: {
      rate: ({ model, usage }) => {
        rated.push({ model, usage });
        return { costNanoUsd: 130_000_000, rateVersion: "registry@test" };
      },
    },
  };
  const projects = createApiFixture<ProjectApi>({
    findWithTeam: async () => project as Awaited<ReturnType<ProjectApi["findWithTeam"]>>,
  });
  const modelProviders = createApiFixture<ModelProviderApi>({
    findRowServingModel: async () => (servingRowId ? executionRow(servingRowId) : null),
    getExecutionProviders: async () => ({ openai: executionRow("mp_default") }),
  });

  return {
    sent,
    rated,
    service: GatewayInternalProtocolService.create(
      suppliedMembers({
        spend: withPipeline ? spend : undefined,
        projects,
        providerRows: modelProviders,
      }),
    ),
  };
}

describe("recordProviderUsage", () => {
  /** @scenario A platform call on stored provider credentials lands on the ledger and debits its budgets */
  it("rates the quantities and appends one confirmed outcome attributed to project, team and organization", async () => {
    const { sent, rated, service } = serviceOver();

    expect(await service.recordProviderUsage(EMBEDDINGS)).toEqual({ status: "recorded" });

    expect(rated).toEqual([
      {
        model: "openai/text-embedding-3-large",
        usage: expect.objectContaining({ input_tokens: 1_000_000, output_tokens: 0 }),
      },
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      gateway_request_id: "topic_clustering:run-1:0",
      tenantId: "project-1",
      organization_id: "org-1",
      team_id: "team-1",
      model_provider_id: "mp_openai",
      request_type: "topic_clustering",
      virtual_key_id: "",
      admitted_at: 0,
      cost_nano_usd: 130_000_000,
      rate_version: "registry@test",
      duration_ms: 840,
    });
  });

  /** @scenario A platform call that names no provider row is attributed to the row serving its model */
  it("resolves the stored row serving the model when the caller names none", async () => {
    const { sent, service } = serviceOver();

    await service.recordProviderUsage({ ...EMBEDDINGS, modelProviderId: undefined });

    expect(sent[0]).toMatchObject({ model_provider_id: "mp_serving" });
  });

  it("falls back to the project's execution row for the provider", async () => {
    const { sent, service } = serviceOver({ servingRowId: null });

    await service.recordProviderUsage({ ...EMBEDDINGS, modelProviderId: undefined });

    expect(sent[0]).toMatchObject({ model_provider_id: "mp_default" });
  });

  /** @scenario A platform call for a project with no team is reported, not written half attributed */
  it("answers unattributed and writes nothing for a project with no team", async () => {
    const { sent, service } = serviceOver({ project: null });

    expect(await service.recordProviderUsage(EMBEDDINGS)).toEqual({ status: "unattributed" });
    expect(sent).toEqual([]);
  });

  it("answers unavailable on a process with no spend pipeline registered", async () => {
    const { sent, service } = serviceOver({ withPipeline: false });

    expect(await service.recordProviderUsage(EMBEDDINGS)).toEqual({ status: "unavailable" });
    expect(sent).toEqual([]);
  });
});
