/**
 * The agent-to-page UI-action dispatch surface — `langwatch ui call` /
 * `langwatch ui actions` land here, authenticated with the worker's own
 * per-conversation session key.
 *
 * Mounted under `/api/langy/ui`, beside the key-authed turn surface
 * (`langy-turns.api.ts`) and deliberately NOT under `/api/internal` (which the
 * Helm ingress blocks). Same refusal order as that family, same dark-404
 * stance: with `release_langy_ui_actions` off the surface answers Hono's own
 * `c.notFound()`, byte-identical to an unmounted path, so rollback looks like
 * the feature was never deployed.
 *
 * The dispatch enforces the ACTION's own permission as the API-key ceiling
 * (`experiments:update` for a workbench write, `evaluations:create` for a
 * run), so the browser path, which executes under the human's full session,
 * can never be used to exceed what the worker's key holds. The conversation id
 * in the body is a claim, not a credential: the service proves it belongs to
 * the key's owning user and project, and a foreign id dies as not-found
 * without confirming anything exists.
 */

import { handlerManagedAuth } from "@langwatch/api";
import { bodyLimit, type AppRestSecurity, type MountableRestApp } from "@langwatch/api/rest";
import {
  LangyApiRequestInvalidError,
  LangyConversationNotFoundError,
  LangyUiActionUnknownError,
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
import { LangyTokenBuffer } from "#streaming/langy-token-buffer";
import { LANGY_UI_ACTIONS_FLAG } from "#ports/langy-turn-runtime.port";
import { resolveLangyRestCaller, type LangyRestCredentialPorts } from "./langy-rest.credentials";

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
 *
 * `GET /actions` publishes the whole catalogue — that is how a CLI discovers
 * what it may dispatch and with what payload — and the service, which only
 * ever resolves a kind somebody already named, has no reason to enumerate.
 * Extending the port here rather than widening the service's keeps a process
 * that composes only the panel from having to answer a question it never asks.
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
     * Runs an action server-side when the page is away, where this process can.
     *
     * Absent means an away page is a refusal rather than a silent backend run —
     * the honest answer for a process that holds no workbench execution stack.
     */
    backendRunner?: UiActionBackendRunner | undefined;
  }>;

const dispatchBodySchema = z.object({
  conversationId: z.string().min(1),
  kind: z.string().min(1),
  payload: z.unknown().optional(),
  /**
   * Which experiment a backend fallback applies the action to. The browser
   * path ignores it (the open page IS the experiment); without it a fallback
   * for a workbench action refuses with `langy_ui_experiment_required`.
   */
  experimentSlug: z.string().min(1).optional(),
});

/** Builds the `/api/langy/ui/actions` family over one process's ports. */
export function createLangyUiActionsRestApp(options: {
  security: AppRestSecurity;
  ports: LangyUiActionsRestPorts;
}): MountableRestApp {
  const { security, ports } = options;
  const secured = security.createServiceApp({
    basePath: "/api/langy/ui",
    errorEnvelope: "canonical",
  });

  const service = () => {
    const langy = ports.langy();
    const redis = ports.redis();
    return new LangyUiActionService({
      redis,
      conversations: {
        findByIdVisible: (args) => langy.tryFindVisible(args),
      },
      buffer: LangyTokenBuffer.create({ redis }),
      actions: ports.actions(),
      ...(ports.backendRunner ? { backendRunner: ports.backendRunner } : {}),
    });
  };

  secured
    .access(uiActionAuth)
    .post("/actions", bodyLimit({ maxSize: MAX_ACTION_BODY_BYTES }), async (c) => {
      const caller = await resolveLangyRestCaller({
        request: c.req.raw,
        ports,
        flag: LANGY_UI_ACTIONS_FLAG,
      });
      if (caller.dark) return c.notFound();

      const parsed = dispatchBodySchema.safeParse(await c.req.json().catch(() => null));
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
    });

  secured.access(uiActionAuth).get("/actions", async (c) => {
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
  });

  return secured.hono;
}
