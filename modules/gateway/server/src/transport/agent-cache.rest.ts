import { GatewayApi } from "@langwatch/gateway-contract";
import {
  DEFAULT_AGENT_CACHE_TTL_SECONDS,
  gatewayAgentCacheClaimedSchema,
  gatewayAgentCacheDeletedSchema,
  gatewayAgentCacheEntrySchema,
  gatewayAgentCacheNameParamsSchema,
  gatewayAgentCacheWriteSchema,
  gatewayAgentCacheWrittenSchema,
} from "@langwatch/gateway-contract/gateway-agent-cache-schemas";
import {
  canonicalBaseResponses,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
} from "@langwatch/api/rest";

export const agentCacheRest = defineRestRouter(GatewayApi)
  .withNamespace("agent-cache")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: true })
  .get("/api/agent-cache/:name", "getAgentCacheEntry")
  .withParams(gatewayAgentCacheNameParamsSchema)
  .withPermission("agentCache:manage")
  .withOutput(gatewayAgentCacheEntrySchema)
  .withDocs({
    summary: "Read an agent cache entry",
    description:
      "Read a cache entry by name. An absent or expired entry answers 404. The value is returned only to a caller that can manage the project's agent cache.",
    responses: canonicalBaseResponses,
  })
  .handle(({ app, input, scope }) =>
    app.getAgentCacheEntry({ projectId: scope.id, name: input.name }),
  )
  .put("/api/agent-cache/:name", "putAgentCacheEntry")
  .withParams(gatewayAgentCacheNameParamsSchema)
  .withInput(gatewayAgentCacheWriteSchema)
  .withPermission("agentCache:manage")
  .withOutput(gatewayAgentCacheWrittenSchema)
  .withDocs({
    summary: "Store an agent cache entry",
    description: `Store or replace an encrypted value. It expires after ttl_seconds, which defaults to ${DEFAULT_AGENT_CACHE_TTL_SECONDS}.`,
    responses: canonicalBaseResponses,
  })
  .handle(({ app, input, scope }) =>
    app.putAgentCacheEntry({
      projectId: scope.id,
      name: input.name,
      value: input.value,
      ttlSeconds: input.ttl_seconds,
    }),
  )
  .post("/api/agent-cache/:name/claim", "claimAgentCacheEntry")
  .withParams(gatewayAgentCacheNameParamsSchema)
  .withInput(gatewayAgentCacheWriteSchema)
  .withPermission("agentCache:manage")
  .withOutput(gatewayAgentCacheClaimedSchema)
  .withDocs({
    summary: "Claim an agent cache entry",
    description:
      "Store the value only while the name is free. The claimed field reports whether this caller took it.",
    responses: canonicalBaseResponses,
  })
  .handle(({ app, input, scope }) =>
    app.claimAgentCacheEntry({
      projectId: scope.id,
      name: input.name,
      value: input.value,
      ttlSeconds: input.ttl_seconds,
    }),
  )
  .delete("/api/agent-cache/:name", "deleteAgentCacheEntry")
  .withParams(gatewayAgentCacheNameParamsSchema)
  .withPermission("agentCache:manage")
  .withOutput(gatewayAgentCacheDeletedSchema)
  .withDocs({
    summary: "Delete an agent cache entry",
    description: "Delete by name. Removing a name the project does not hold still succeeds.",
    responses: canonicalBaseResponses,
  })
  .handle(async ({ app, input, scope }) => {
    await app.deleteAgentCacheEntry({ projectId: scope.id, name: input.name });
    return { name: input.name, deleted: true };
  })
  .build();
