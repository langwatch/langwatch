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
  langyUiActionDispatchBodySchema,
} from "@langwatch/langy-contract";
import { z } from "zod";

import type { LangyApp } from "#app/langy.app";
import { type LangyUiActionCatalog, type LangyUiActionDefinition } from "#app/langy.members";
import {
  LangyUiActionService,
  type UiActionBackendRunner,
  type UiActionRedis,
} from "#services/langy-ui-action.service";

import type { LangyRestCeiling } from "./langy-rest-credentials.ts";

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
  abstract getByKind(kind: string): LangyUiActionDefinition;
}

/**
 * Everything the UI-action surface reaches that neither `LangyApi` nor
 * the framework's own project door supplies.
 */
export type LangyUiActionsRestMembers = Readonly<{
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
const HONO_NOT_FOUND = {
  status: 404,
  mediaType: "text/plain;charset=UTF-8",
  body: "404 Not Found",
} as const;

/** The CLI's wire: the action outcome as JSON, or the dark surface's bare 404. */
const UI_ACTIONS_ANSWER = {
  produces: ["application/json", "text/plain;charset=UTF-8"],
  because: "The CLI reads a bare 404 as the rollout being dark for the project.",
} as const;

export const langyUiActionsRest = defineRestRouter(LangyApi)
  .withNamespace("langy")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("project")
  .withAddressing("literal", { v1Twin: false })

  .post("/api/langy/ui/actions", "langyUiActionsDispatch")
  .withAccess(deferredScope({ reason: AUTH_REASON }))
  .withRawBody("text")
  .withBodyLimit({ maxBytes: MAX_ACTION_BODY_BYTES, onExceeded: () => new PayloadTooLargeError() })
  .withResponse("protocol", UI_ACTIONS_ANSWER)
  .withDocs({
    description:
      "The dispatch answers the action service's own outcome, and a plain 404 when the " +
      "rollout is dark for the project.",
  })
  .withMiddleware(langyUiActionsRestMembers)
  .handle(async ({ app, raw, request, response }, members) => {
    const resolved = projectCredentialOfRequest(request);
    const caller = await app.getRestCaller({ credential: resolved, surface: "ui_actions" });
    if (caller.dark) return response.write(HONO_NOT_FOUND);

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
    const definition = members.actions().getByKind(kind);
    await members.enforceCeiling({ resolved, permission: definition.requiredPermission });

    const langy = members.langy();
    const redis = members.redis();
    const service = LangyUiActionService.create({
      redis,
      conversations: {
        getById: (args) => langy.getById(args),
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
    });
    return response.write({
      status: 200,
      mediaType: "application/json",
      body: JSON.stringify(outcome),
    });
  })

  .get("/api/langy/ui/actions", "langyUiActionsList")
  .withAccess(deferredScope({ reason: AUTH_REASON }))
  .withResponse("protocol", UI_ACTIONS_ANSWER)
  .withDocs({
    description:
      "The catalogue publishes each action's own draft-07 payload schema, which the CLI " +
      "reads as it stands.",
  })
  .withMiddleware(langyUiActionsRestMembers)
  .handle(async ({ app, request, response }, members) => {
    const caller = await app.getRestCaller({
      credential: projectCredentialOfRequest(request),
      surface: "ui_actions",
    });
    if (caller.dark) return response.write(HONO_NOT_FOUND);

    return response.write({
      status: 200,
      mediaType: "application/json",
      body: JSON.stringify({
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
      }),
    });
  })

  .build();
