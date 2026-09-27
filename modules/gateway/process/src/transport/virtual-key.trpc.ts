/**
 * The server half of `virtualKeys.*`, organization-scoped. Authorization is
 * per-scope and data-dependent, so every procedure declares itself
 * service-authorized; the plaintext key answers only from create and rotate.
 */
import { defineTrpcFact, defineTrpcRouter } from "@langwatch/api/trpc";
import { GatewayApi, virtualKeyTrpc } from "@langwatch/gateway-contract";
import { type Instant, Temporal, type TimeInput, toEpochMs } from "@langwatch/time";
import { z } from "zod";

/** The expiry a request carries, as the application reads it. */
function toExpiryInstant(value: TimeInput | null | undefined): Instant | null | undefined {
  return value === undefined || value === null
    ? value
    : Temporal.Instant.fromEpochMilliseconds(toEpochMs(value));
}

/**
 * Who the request arrived as, bound once at the mount. Opaque on purpose: what
 * a session IS belongs to the process's authentication, not to this module, so
 * the handlers pass it straight to the checks and never read it.
 */
export const gatewaySessionFact = defineTrpcFact("gatewaySession", z.unknown());

/**
 * The reason every procedure here declares. Each one names the permissions the
 * application actually enforces, which is what keeps a per-scope decision
 * reviewable without pretending the transport could make it.
 */
const RESOLVER_AUTHORIZED =
  "the scopes a virtual key lives in are data the application loads, so the per-scope check happens there";

export const virtualKeyTrpcTransport = defineTrpcRouter(GatewayApi, virtualKeyTrpc)
  // Visibility is membership-based, not permission-based: a caller sees a key
  // when one of its scopes intersects their membership set, so a plain
  // organization member can list without a coarse organization-wide
  // `virtualKeys:view` grant they would not hold.
  .procedure("list")
  .serviceAuthorized({
    reason: `${RESOLVER_AUTHORIZED}; only keys whose scopes intersect the caller's membership in this organization are returned`,
    permissions: ["virtualKeys:view"],
  })
  .handle(async ({ app, input, actor }) => {
    const keys = await app.listVisibleVirtualKeys({
      organizationId: input.organizationId,
      userId: actor.id,
    });

    return app.toVirtualKeyCamelDtos({ virtualKeys: keys });
  })

  .procedure("get")
  .serviceAuthorized({
    reason: `${RESOLVER_AUTHORIZED}; the key must exist in this organization and intersect the caller's membership set, and a miss is answered as not found`,
    permissions: ["virtualKeys:view"],
  })
  .handle(async ({ app, input, actor }) => {
    // A key the caller cannot see is indistinguishable from one that does not
    // exist - same not-found answer, no existence leak.
    const vk = await app.getVisibleVirtualKeyForUser({
      organizationId: input.organizationId,
      id: input.id,
      userId: actor.id,
    });

    return app.toVirtualKeyCamelDto(vk);
  })

  // Reads the same cost path the Usage tab does, so the table matches the page.
  .procedure("spendThisMonth")
  .serviceAuthorized({
    reason: `${RESOLVER_AUTHORIZED}; spend is reported only for keys visible to the caller's membership in this organization`,
    permissions: ["virtualKeys:view"],
  })
  .handle(({ app, input, actor }) =>
    app.listVirtualKeySpendThisMonth({ organizationId: input.organizationId, userId: actor.id }),
  )

  // Takes a draft (picked scopes, no key row yet) so the list is answerable
  // before the key is created.
  .procedure("applicableBudgets")
  .withFacts(gatewaySessionFact)
  .serviceAuthorized({
    reason: `${RESOLVER_AUTHORIZED}; for an existing key, its visibility in this organization, and for a draft, manage on every scope in it, both checked before any budget data is read`,
    permissions: ["virtualKeys:view", "virtualKeys:manage"],
  })
  .handle(({ app, input, actor }, caller) =>
    app.listApplicableBudgetsForSelection({ selection: input, userId: actor.id, caller }),
  )

  .procedure("create")
  .withFacts(gatewaySessionFact)
  .serviceAuthorized({
    reason: `${RESOLVER_AUTHORIZED}; manage on every requested scope, and every scope anchored to this organization, both before the key is minted`,
    permissions: ["virtualKeys:manage"],
  })
  .handle(async ({ app, input, actor }, caller) => {
    // The same pre-flight the public REST create runs: manage at every
    // requested scope, scopes inside the caller's organization, the
    // destination anchored and manageable, guardrail references project-local.
    await app.authorizeVirtualKeyCreate({
      actor: caller,
      organizationId: input.organizationId,
      scopes: input.scopes,
      traceProjectId: input.traceProjectId,
      guardrailAttachments: input.config?.guardrailAttachments,
    });
    const { virtualKey, secret, reveal } = await app.createVirtualKey({
      organizationId: input.organizationId,
      name: input.name,
      description: input.description ?? null,
      principalUserId: input.principalUserId ?? null,
      scopes: input.scopes,
      traceProjectId: input.traceProjectId ?? null,
      routingPolicyId: input.routingPolicyId ?? null,
      routingMode: input.routingMode,
      expiresAt: toExpiryInstant(input.expiresAt) ?? null,
      budget: input.budget ?? null,
      config: input.config,
      actorUserId: actor.id,
      revealOnce: input.revealOnce === true,
    });

    // The one moment the plaintext key exists on the wire.
    return {
      virtualKey: await app.toVirtualKeyCamelDto(virtualKey),
      secret,
      ...(reveal ? { revealId: reveal.revealId, preview: reveal.preview } : {}),
    };
  })

  .procedure("update")
  .withFacts(gatewaySessionFact)
  .serviceAuthorized({
    reason: `${RESOLVER_AUTHORIZED}; update on one of the key's existing scopes, plus manage on every new scope when re-scoping`,
    permissions: ["virtualKeys:update", "virtualKeys:manage"],
  })
  .handle(async ({ app, input, actor }, caller) => {
    // The same pre-flight the public REST patch runs: update on a scope the
    // key already lives in, manage on every new scope when re-scoping, the
    // destination anchored and manageable when it moves, and the guardrail
    // attachments judged against the project the key resolves to.
    await app.authorizeVirtualKeyUpdate({
      actor: caller,
      organizationId: input.organizationId,
      id: input.id,
      scopes: input.scopes,
      traceProjectId: input.traceProjectId,
      guardrailAttachments: input.config?.guardrailAttachments,
    });
    const updated = await app.updateVirtualKey({
      id: input.id,
      organizationId: input.organizationId,
      name: input.name,
      description: input.description,
      scopes: input.scopes,
      traceProjectId: input.traceProjectId,
      routingPolicyId: input.routingPolicyId,
      routingMode: input.routingMode,
      expiresAt: toExpiryInstant(input.expiresAt),
      budget: input.budget,
      config: input.config,
      actorUserId: actor.id,
    });

    return app.toVirtualKeyCamelDto(updated);
  })

  .procedure("rotate")
  .withFacts(gatewaySessionFact)
  .serviceAuthorized({
    reason: `${RESOLVER_AUTHORIZED}; rotate on one of the key's existing scopes`,
    permissions: ["virtualKeys:rotate"],
  })
  .handle(async ({ app, input, actor }, caller) => {
    await app.authorizeVirtualKeyOperation({
      actor: caller,
      organizationId: input.organizationId,
      id: input.id,
      permission: "virtualKeys:rotate",
    });
    const { virtualKey, secret } = await app.rotateVirtualKey({
      id: input.id,
      organizationId: input.organizationId,
      actorUserId: actor.id,
    });

    // The second and last moment the plaintext key exists on the wire.
    return { virtualKey: await app.toVirtualKeyCamelDto(virtualKey), secret };
  })

  .procedure("revoke")
  .withFacts(gatewaySessionFact)
  .serviceAuthorized({
    reason: `${RESOLVER_AUTHORIZED}; delete on one of the key's existing scopes`,
    permissions: ["virtualKeys:delete"],
  })
  .handle(async ({ app, input, actor }, caller) => {
    await app.authorizeVirtualKeyOperation({
      actor: caller,
      organizationId: input.organizationId,
      id: input.id,
      permission: "virtualKeys:delete",
    });
    const updated = await app.revokeVirtualKey({
      id: input.id,
      organizationId: input.organizationId,
      actorUserId: actor.id,
    });

    return app.toVirtualKeyCamelDto(updated);
  })

  .procedure("disable")
  .withFacts(gatewaySessionFact)
  .serviceAuthorized({
    reason: `${RESOLVER_AUTHORIZED}; update on one of the key's existing scopes`,
    permissions: ["virtualKeys:update"],
  })
  .handle(async ({ app, input, actor }, caller) => {
    await app.authorizeVirtualKeyOperation({
      actor: caller,
      organizationId: input.organizationId,
      id: input.id,
      permission: "virtualKeys:update",
    });
    const updated = await app.disableVirtualKey({
      id: input.id,
      organizationId: input.organizationId,
      actorUserId: actor.id,
      reason: input.reason ?? null,
    });

    return app.toVirtualKeyCamelDto(updated);
  })

  .procedure("enable")
  .withFacts(gatewaySessionFact)
  .serviceAuthorized({
    reason: `${RESOLVER_AUTHORIZED}; update on one of the key's existing scopes`,
    permissions: ["virtualKeys:update"],
  })
  .handle(async ({ app, input, actor }, caller) => {
    await app.authorizeVirtualKeyOperation({
      actor: caller,
      organizationId: input.organizationId,
      id: input.id,
      permission: "virtualKeys:update",
    });
    const updated = await app.enableVirtualKey({
      id: input.id,
      organizationId: input.organizationId,
      actorUserId: actor.id,
    });

    return app.toVirtualKeyCamelDto(updated);
  })
  .build();
