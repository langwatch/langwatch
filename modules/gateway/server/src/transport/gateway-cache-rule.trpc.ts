/**
 * The server half of `gatewayCacheRules.*`. The rule bundle reaches the data
 * plane through the config materialiser, never through here; this is the
 * platform surface for the rules themselves.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import {
  GatewayApi,
  gatewayCacheRuleTrpc,
  GatewayCacheRuleNotFoundError,
  type GatewayCacheRuleResource,
} from "@langwatch/gateway-contract";

/**
 * The wire row, unchanged: `modeEnum` keeps its name because the browser and
 * the CLI read it, even though the canonical resource calls the field `mode`.
 */
function toDto(r: GatewayCacheRuleResource) {
  return {
    id: r.id,
    organizationId: r.organizationId,
    name: r.name,
    description: r.description,
    priority: r.priority,
    enabled: r.enabled,
    matchers: r.matchers,
    action: r.action,
    modeEnum: r.mode,
    archivedAt: r.archivedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export const gatewayCacheRuleTrpcTransport = defineTrpcRouter(GatewayApi, gatewayCacheRuleTrpc)
  .procedure("list")
  .withPermission("gatewayCacheRules:view")
  .handle(async ({ app, input }) => {
    await app.assertOrganizationExists(input.organizationId);
    const rows = await app.listCacheRules(input.organizationId);

    return rows.map(toDto);
  })

  .procedure("get")
  .withPermission("gatewayCacheRules:view")
  .handle(async ({ app, input }) => {
    await app.assertOrganizationExists(input.organizationId);
    const row = await app.findCacheRule({ id: input.id, organizationId: input.organizationId });
    if (!row) throw new GatewayCacheRuleNotFoundError();

    return toDto(row);
  })

  .procedure("create")
  .withPermission("gatewayCacheRules:create")
  .handle(async ({ app, input, actor }) => {
    await app.assertOrganizationExists(input.organizationId);
    const row = await app.createCacheRule({
      organizationId: input.organizationId,
      name: input.name,
      description: input.description ?? null,
      priority: input.priority,
      enabled: input.enabled,
      matchers: input.matchers,
      action: input.action,
      actorUserId: actor.id,
    });

    return toDto(row);
  })

  .procedure("update")
  .withPermission("gatewayCacheRules:update")
  .handle(async ({ app, input, actor }) => {
    await app.assertOrganizationExists(input.organizationId);
    const row = await app.updateCacheRule({
      id: input.id,
      organizationId: input.organizationId,
      name: input.name,
      description: input.description,
      priority: input.priority,
      enabled: input.enabled,
      matchers: input.matchers,
      action: input.action,
      actorUserId: actor.id,
    });

    return toDto(row);
  })

  .procedure("archive")
  .withPermission("gatewayCacheRules:delete")
  .handle(async ({ app, input, actor }) => {
    await app.assertOrganizationExists(input.organizationId);
    const row = await app.archiveCacheRule({
      id: input.id,
      organizationId: input.organizationId,
      actorUserId: actor.id,
    });

    return toDto(row);
  })
  .build();
