// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * `/api/governance/registry`: the organisation's agent registry, its change feed and its ARD v0.91
 * view, read with an organisation API key holding `governance:view`.
 * Spec: enterprise/modules/governance/specs/agent-registry.feature
 */
import { baseResponses, defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import {
  agentRegistryDetailResponseSchema,
  agentRegistryEntrySchema,
  agentRegistryEventSchema,
  agentRegistryEventsQuerySchema,
  agentRegistryEventsResponseSchema,
  agentRegistryListQuerySchema,
  agentRegistryListResponseSchema,
  agentRegistryParamsSchema,
  agentRegistrySchemaResponseSchema,
  ardManifestSchema,
  ardSearchRequestSchema,
  ardSearchResponseSchema,
  GovernanceRestApi,
} from "@langwatch/enterprise-governance-contract";
import { z } from "zod";

const TAGS = ["Governance / Agent Registry"];

const registrySchemas = {
  entry: z.toJSONSchema(agentRegistryEntrySchema, { target: "draft-2020-12" }),
  event: z.toJSONSchema(agentRegistryEventSchema, { target: "draft-2020-12" }),
};

export const agentRegistryRest = defineRestRouter(GovernanceRestApi)
  .withNamespace("governance-registry")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("organization")
  // The prefix is shared with `/api/governance`, so each route names its whole path.
  .withAddressing("literal", { v1Twin: true })

  .get("/api/governance/registry/agents", "listRegistryAgents")
  .withQuery(agentRegistryListQuerySchema)
  .withPermission("governance:view")
  .withOutput(agentRegistryListResponseSchema)
  .withDocs({
    operationId: "getApiGovernanceRegistryAgents",
    summary: "List the organisation's agent registry",
    tags: TAGS,
    description:
      "Every agent LangWatch sees for the organisation: agents defined in its projects, agents a governance source listed (Databricks Genie, Copilot Studio) and agents its traces name in `gen_ai.agent.name`. Ordered by last change, oldest first; pass `next_cursor` back as `cursor`. `updated_since` returns only entries changed at or after that instant.",
    responses: { ...baseResponses },
  })
  .handle(({ app, input, scope }) =>
    app.listRegistryAgents({
      organizationId: scope.id,
      limit: input.limit,
      ...(input.cursor ? { cursor: input.cursor } : {}),
      ...(input.updated_since ? { updatedSince: input.updated_since } : {}),
      ...(input.status ? { status: input.status } : {}),
    }),
  )

  .get("/api/governance/registry/agents/:agentId", "getRegistryAgent")
  .withParams(agentRegistryParamsSchema)
  .withPermission("governance:view")
  .withOutput(agentRegistryDetailResponseSchema)
  .withDocs({
    operationId: "getApiGovernanceRegistryAgentsById",
    summary: "Get one registry agent",
    tags: TAGS,
    description:
      "One agent with its endpoints, model configuration, system instructions, tools with JSON Schema parameters, owner and registry version. An id outside the organisation is a 404 `agent_registry_entry_not_found`.",
    responses: { ...baseResponses },
  })
  .handle(async ({ app, input, scope }) => ({
    data: await app.getRegistryAgent({ organizationId: scope.id, id: input.agentId }),
  }))

  .get("/api/governance/registry/agents/:agentId/versions", "listRegistryAgentVersions")
  .withParams(agentRegistryParamsSchema)
  .withQuery(agentRegistryEventsQuerySchema)
  .withPermission("governance:view")
  .withOutput(agentRegistryEventsResponseSchema)
  .withDocs({
    operationId: "getApiGovernanceRegistryAgentsByIdVersions",
    summary: "List one registry agent's versions",
    tags: TAGS,
    description:
      "The change events recorded for the agent, oldest first, one page at a time. Each carries `from_version`, `to_version` and the entry as it stood at `to_version`. Pass `next_cursor` back as `cursor` for the next page; it is null on the last page.",
    responses: { ...baseResponses },
  })
  .handle(({ app, input, scope }) =>
    app.listRegistryAgentVersions({
      organizationId: scope.id,
      id: input.agentId,
      ...(input.cursor ? { cursor: input.cursor } : {}),
      limit: input.limit,
    }),
  )

  .get("/api/governance/registry/events", "listRegistryEvents")
  .withQuery(agentRegistryEventsQuerySchema)
  .withPermission("governance:view")
  .withOutput(agentRegistryEventsResponseSchema)
  .withDocs({
    operationId: "getApiGovernanceRegistryEvents",
    summary: "Read the registry change feed",
    tags: TAGS,
    description:
      "The organisation's registry events in order: `governance.agent.registered`, `.versioned`, `.tool_deprecated`, `.removed` and `.flagged_shadow`. Pass the last `sequence` read as `cursor`; the same events are pushed to webhook endpoints subscribed to `governance.agent.*`.",
    responses: { ...baseResponses },
  })
  .handle(({ app, input, scope }) =>
    app.listRegistryEvents({
      organizationId: scope.id,
      limit: input.limit,
      ...(input.cursor ? { after: input.cursor } : {}),
    }),
  )

  .get("/api/governance/registry/schema", "getRegistrySchema")
  .withPermission("governance:view")
  .withOutput(agentRegistrySchemaResponseSchema)
  .withDocs({
    operationId: "getApiGovernanceRegistrySchema",
    summary: "Get the registry's JSON Schemas",
    tags: TAGS,
    description:
      "JSON Schema (draft 2020-12) documents for one registry entry and one change event, for validating what the REST routes, the ARD manifest and the webhooks return.",
    responses: { ...baseResponses },
  })
  .handle(() => registrySchemas)

  .get("/api/governance/registry/ard.json", "getRegistryArdManifest")
  .withPermission("governance:view")
  .withOutput(ardManifestSchema)
  .withDocs({
    operationId: "getApiGovernanceRegistryArdManifest",
    summary: "Get the registry as an ARD manifest",
    tags: TAGS,
    description:
      "The organisation's active agents, up to 1,000 in order of last change, as an Agentic Resource Discovery (ARD v0.91) manifest. Each entry has a `urn:air:<host>:<organization id>:agent:<id>` identifier, type `application/agent-card+json` and the registry entry inline as `data`.",
    responses: { ...baseResponses },
  })
  .handle(({ app, scope }) => app.getRegistryArdManifest({ organizationId: scope.id }))

  .post("/api/governance/registry/ard/search", "searchRegistryArd")
  .keepsRecords()
  .withoutAudit("a read over the registry sent as a POST, as ARD defines search")
  .withInput(ardSearchRequestSchema)
  .withPermission("governance:view")
  .withOutput(ardSearchResponseSchema)
  .withDocs({
    operationId: "postApiGovernanceRegistryArdSearch",
    summary: "Search the registry (ARD search)",
    tags: TAGS,
    description:
      "ARD `POST /search`: `query.text` is matched against names, capabilities, descriptions, instructions and tools; `query.filter` keys are term paths (`tags`, `capabilities`, `data.source`, `data.shadow`), values within a key are OR-ed and keys AND-ed. Results carry a 0 to 100 relevance `score`. Federation is not performed.",
    responses: { ...baseResponses },
  })
  .handle(({ app, input, scope }) =>
    app.searchRegistryArd({ organizationId: scope.id, request: input }),
  )
  .build();
