/**
 * The agent-to-page UI-action dispatch surface — `langwatch ui call` / `langwatch ui actions` land
 * here, authenticated with the worker's own per-conversation session key.
 */

import { PayloadTooLargeError } from "@langwatch/api";
import { deferredScope } from "@langwatch/api/access";
import {
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  projectCredentialOfRequest,
} from "@langwatch/api/rest";
import {
  LangyApi,
  LangyApiRequestInvalidError,
  LangyConversationNotFoundError,
  LangyUiActionUnknownError,
  langyUiActionDispatchBodySchema,
} from "@langwatch/langy-contract";
import { z } from "zod";

import type { LangyApp } from "#app/langy.app";
import {
  type LangyUiActionCatalog,
  type LangyUiActionDefinition,
} from "#app/langy.members";
import {
  LangyUiActionService,
  type UiActionBackendRunner,
  type UiActionRedis,
} from "#services/langy-ui-action.service";
import { LANGY_UI_ACTIONS_FLAG } from "#app/langy.members";
import { LangyRestCallerService } from "#services/langy-rest-caller.service";
import type { LangyActorUserReader } from "#services/langy-actor-session.service";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { LangyRestCeiling } from "./langy-rest-credentials.api.ts";

const AUTH_REASON =
  "the dispatched action's own kind names the permission it requires, so the ceiling is the " +
  "key's ceiling on THAT permission - only the handler, having read the body, knows which one";

/** An action payload is a small JSON document, never an upload. */
const MAX_ACTION_BODY_BYTES = 256 * 1024;

/**
 * The catalogue this DOOR needs, which is one method wider than the service's.
 */
export abstract class LangyUiActionRestCatalog implements LangyUiActionCatalog {
  /** Every kind this process serves, in no particular order. */
  abstract list(): readonly Readonly<{
    kind: string;
    definition: LangyUiActionDefinition;
  }>[];
  abstract tryFind(kind: string): LangyUiActionDefinition | null;
}

/**
 * Everything the UI-action surface reaches that neither `LangyApi` nor
 * the framework's own project door supplies.
 */
export type LangyUiActionsRestMembers = Readonly<{
  /** This deployment's flag store, for the rollout gate and the identity bridge. */
  featureFlags: () => FeatureFlagApi;
  /** The user directory a key's owner is read from. */
  actors: () => LangyActorUserReader;
  /** Enforces one permission as the key's ceiling — the dispatched action's own. */
  enforceCeiling: LangyRestCeiling;
  /** The SAME application the browser's Langy procedures resolve on. */
  langy: () => LangyApp;
  /**
   * The process's Redis. The channel is a claim key, a result list and a
   * blocking pop, so there is no in-memory degradation: a process with no
   * Redis composes no ports at all and the family is not mounted.
   */
  redis: () => UiActionRedis;
  /** Which kinds exist, and what each one's payload must look like. */
  actions: () => LangyUiActionRestCatalog;
  /**
   * Runs an action server-side when the page is away, where this process can. Absent means an
   * away page is a refusal rather than a silent backend run — the honest answer for a process
   * that holds no workbench execution stack.
   */
  backendRunner?: UiActionBackendRunner | undefined;
}>;

/** What the process supplies this family beyond `LangyApi` and its own door. */
export const langyUiActionsRestMembers = defineRestMiddleware(
  "langyUiActionsRestMembers",
  z.custom<LangyUiActionsRestMembers>(),
);

/** Hono's own 404, byte-for-byte what an unmounted path returns. */
const notFoundAnswer = (): Response => new Response("404 Not Found", { status: 404 });

export const langyUiActionsRest = defineRestRouter(LangyApi)
  .withNamespace("langy")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("project")
  .withAddressing("literal", { v1Twin: false })

  .post("/api/langy/ui/actions", "langyUiActionsDispatch")
  .withAccess(deferredScope({ reason: AUTH_REASON }))
  .withRawBody("text")
  .withBodyLimit({ maxBytes: MAX_ACTION_BODY_BYTES, onExceeded: () => new PayloadTooLargeError() })
  .withRawResponse({ produces: "application/json" })
  .withDocs({
    description:
      "The dispatch answers the action service's own outcome, and a plain 404 when the " +
      "rollout is dark for the project.",
  })
  .withMiddleware(langyUiActionsRestMembers)
  .handle(async ({ raw, request }, members) => {
    const resolved = projectCredentialOfRequest(request);
    const caller = await LangyRestCallerService.create({
      featureFlags: members.featureFlags(),
      actors: members.actors(),
    }).resolve({ resolved, flag: LANGY_UI_ACTIONS_FLAG });
    if (caller.dark) return notFoundAnswer();

    let parsedRaw: unknown;
    try {
      parsedRaw = JSON.parse(raw);
    } catch {
      parsedRaw = null;
    }
    const parsed = langyUiActionDispatchBodySchema.safeParse(parsedRaw);
    if (!parsed.success) {
      throw new LangyApiRequestInvalidError(parsed.error.issues);
    }
    const { conversationId, kind, payload, experimentSlug } = parsed.data;

    // The action's own permission is the key's ceiling for this dispatch.
    // Unknown kinds refuse before the ceiling so the error names the real
    // problem (the kind), not a permission the caller cannot reason about.
    const definition = members.actions().tryFind(kind);
    if (!definition) throw new LangyUiActionUnknownError(kind);
    await members.enforceCeiling({ resolved, permission: definition.requiredPermission });

    const langy = members.langy();
    const redis = members.redis();
    const service = LangyUiActionService.create({
      redis,
      conversations: {
        findByIdVisible: (args) => langy.tryFindVisible(args),
      },
      buffer: langy.repositories.tokenBuffer.open({ redis }),
      actions: members.actions(),
      ...(members.backendRunner ? { backendRunner: members.backendRunner } : {}),
    });

    const outcome = await service.dispatch({
      projectId: caller.projectId,
      userId: caller.userId,
      conversationId,
      kind,
      payload: payload ?? {},
      ...(experimentSlug ? { experimentSlug } : {}),
      notFound: () => new LangyConversationNotFoundError(conversationId),
    });
    return Response.json(outcome, { status: 200 });
  })

  .get("/api/langy/ui/actions", "langyUiActionsList")
  .withAccess(deferredScope({ reason: AUTH_REASON }))
  .withRawResponse({ produces: "application/json" })
  .withDocs({
    description:
      "The catalogue publishes each action's own draft-07 payload schema, which the CLI " +
      "reads as it stands.",
  })
  .withMiddleware(langyUiActionsRestMembers)
  .handle(async ({ request }, members) => {
    const resolved = projectCredentialOfRequest(request);
    const caller = await LangyRestCallerService.create({
      featureFlags: members.featureFlags(),
      actors: members.actors(),
    }).resolve({ resolved, flag: LANGY_UI_ACTIONS_FLAG });
    if (caller.dark) return notFoundAnswer();

    return Response.json(
      {
        actions: members
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
      { status: 200 },
    );
  })

  .build();
