/**
 * The agent-to-page UI-action dispatch surface — `langwatch ui call` / `langwatch ui actions` land
 * here, authenticated with the worker's own per-conversation session key.
 */

import { handlerManagedAuth } from "@langwatch/api";
import {
  bodyLimit,
  type AppRestSecurity,
  type EndpointVariables,
  MANAGEMENT_API_VERSION,
  type MountableRestApp,
  type ServiceContext,
} from "@langwatch/api/rest";
import {
  LangyApiRequestInvalidError,
  LangyConversationNotFoundError,
  LangyUiActionUnknownError,
  langyUiActionDispatchBodySchema,
} from "@langwatch/langy-contract";
import { z } from "zod";

import type { LangyApp } from "#app/langy.app";
import {
  LangyUiActionCatalogPort,
  type LangyUiActionDefinition,
} from "#ports/langy-ui-action-catalog.port";
import {
  LangyUiActionService,
  type UiActionBackendRunner,
  type UiActionRedis,
} from "#services/langy-ui-action.service";
import { LangyTokenBufferRedisRepository } from "#repositories/redis/redis.langy-token-buffer.repository";
import { LANGY_UI_ACTIONS_FLAG } from "#ports/langy-turn-runtime.port";
import {
  resolveLangyRestCaller,
  type LangyRestCredentialPorts,
} from "./langy-rest-credentials.api.ts";

const AUTH_REASON =
  "session key resolved in-handler by the API-key service + the process's ceiling port on the dispatched action's own permission, then bridged to the owning user by resolveLangyKeyIdentity";

/** An action payload is a small JSON document, never an upload. */
const MAX_ACTION_BODY_BYTES = 256 * 1024;

const uiActionAuth = handlerManagedAuth({
  reason: AUTH_REASON,
  permissions: ["experiments:view", "experiments:update", "evaluations:create"],
  credential: "apiKey",
});

/**
 * The catalogue this DOOR needs, which is one method wider than the service's.
 */
export abstract class LangyUiActionRestCatalogPort extends LangyUiActionCatalogPort {
  /** Every kind this process serves, in no particular order. */
  abstract list(): readonly Readonly<{
    kind: string;
    definition: LangyUiActionDefinition;
  }>[];
}

/** Everything the UI-action surface reaches that Langy does not own. */
export type LangyUiActionsRestPorts = LangyRestCredentialPorts &
  Readonly<{
    /** The SAME application the browser's Langy procedures resolve on. */
    langy: () => LangyApp;
    /**
     * The process's Redis. The channel is a claim key, a result list and a
     * blocking pop, so there is no in-memory degradation: a process with no
     * Redis composes no ports at all and the family is not mounted.
     */
    redis: () => UiActionRedis;
    /** Which kinds exist, and what each one's payload must look like. */
    actions: () => LangyUiActionRestCatalogPort;
    /**
     * Runs an action server-side when the page is away, where this process can. Absent means an
     * away page is a refusal rather than a silent backend run — the honest answer for a process
     * that holds no workbench execution stack.
     */
    backendRunner?: UiActionBackendRunner | undefined;
  }>;

/** Builds the `/api/langy/ui/actions` family over one process's ports. */
export function createLangyUiActionsRestApp(options: {
  security: AppRestSecurity;
  ports: LangyUiActionsRestPorts;
}): MountableRestApp {
  const { security, ports } = options;

  const { service: restService, policy } = security.createServiceVersionedApp({
    name: "langy-ui",
    basePath: "/api/langy/ui",
    // `langwatch ui call` posts this exact path; the dispatch surface serves
    // one generation rather than a dated namespace.
    staticGeneration: "v1",
    errorEnvelope: "canonical",
  });

  const uiDoor = policy(uiActionAuth);

  const service = () => {
    const langy = ports.langy();
    const redis = ports.redis();
    return LangyUiActionService.create({
      redis,
      conversations: {
        findByIdVisible: (args) => langy.tryFindVisible(args),
      },
      buffer: LangyTokenBufferRedisRepository.create({ redis }),
      actions: ports.actions(),
      ...(ports.backendRunner ? { backendRunner: ports.backendRunner } : {}),
    });
  };

  const dispatchHandler = async (c: ServiceContext<EndpointVariables>) => {
    const caller = await resolveLangyRestCaller({
      request: c.req.raw,
      ports,
      flag: LANGY_UI_ACTIONS_FLAG,
    });
    if (caller.dark) return c.notFound();

    const parsed = langyUiActionDispatchBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new LangyApiRequestInvalidError(parsed.error.issues);
    }
    const { conversationId, kind, payload, experimentSlug } = parsed.data;

    // The action's own permission is the key's ceiling for this dispatch.
    // Unknown kinds refuse before the ceiling so the error names the real
    // problem (the kind), not a permission the caller cannot reason about.
    const definition = ports.actions().tryFind(kind);
    if (!definition) throw new LangyUiActionUnknownError(kind);
    await ports.enforceCeiling({
      resolved: caller.resolved,
      permission: definition.requiredPermission,
    });

    const outcome = await service().dispatch({
      projectId: caller.projectId,
      userId: caller.userId,
      conversationId,
      kind,
      payload: payload ?? {},
      ...(experimentSlug ? { experimentSlug } : {}),
      notFound: () => new LangyConversationNotFoundError(conversationId),
    });
    return c.json(outcome, 200);
  };

  const listHandler = async (c: ServiceContext<EndpointVariables>) => {
    const caller = await resolveLangyRestCaller({
      request: c.req.raw,
      ports,
      flag: LANGY_UI_ACTIONS_FLAG,
    });
    if (caller.dark) return c.notFound();

    return c.json(
      {
        actions: ports
          .actions()
          .list()
          .map(({ kind, definition }) => ({
            kind,
            permission: definition.requiredPermission,
            backend: definition.backend,
            // Zod 4 renders its own JSON Schema; `zod-to-json-schema` only types
            // against zod 3. Pinned to draft-07 and inlined so the document the
            // CLI reads is the one this surface has always published.
            payloadSchema: z.toJSONSchema(definition.payloadSchema as z.ZodType, {
              target: "draft-07",
              reused: "inline",
            }),
          })),
      },
      200,
    );
  };

  return restService
    .registerRoute("post", "/actions", MANAGEMENT_API_VERSION, dispatchHandler, (b) =>
      uiDoor(b)
        .withMiddleware(bodyLimit({ maxSize: MAX_ACTION_BODY_BYTES }))
        .withRawResponse(
          "the dispatch answers the action service's own outcome, and Hono's own 404 " +
            "when the rollout is dark for the project",
        ),
    )
    .registerRoute("get", "/actions", MANAGEMENT_API_VERSION, listHandler, (b) =>
      uiDoor(b).withRawResponse(
        "the catalogue publishes each action's own draft-07 payload schema, which " +
          "the CLI reads as it stands",
      ),
    )
    .build();
}
