/**
 * The agent-to-page UI-action dispatch surface — `langwatch ui call` /
 * `langwatch ui actions` land here, authenticated with the worker's own
 * per-conversation session key.
 *
 * Mounted under `/api/langy/ui`, beside the key-authed turn surface
 * (`langy-api.ts`) and deliberately NOT under `/api/internal` (which the Helm
 * ingress blocks). Same refusal order as that route family, same dark-404
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

import type { Context } from "hono";
import { z } from "zod";
import { createServiceApp } from "~/server/api/security";
import { handlerManagedAuth } from "@langwatch/platform-api/app-rest";
import { enforceApiKeyCeiling, extractCredentials } from "~/server/api-key/auth-middleware";
import type { App } from "~/server/app-layer/app";
import {
  LangyApiCredentialInvalidError,
  LangyApiCredentialMissingError,
  LangyApiIdentityDeniedError,
  LangyApiRequestInvalidError,
  LangyConversationNotFoundError,
} from "@langwatch/langy-contract";
import { LangyTokenBuffer } from "@langwatch/langy-server";
import { resolveLangyKeyIdentity } from "~/runtime/app/features/langy-api-key-identity.adapter";
import { LangyUiActionUnknownError } from "~/server/app-layer/langy/ui-actions/errors";
import { findPageAction, listPageActions } from "~/server/app-layer/langy/ui-actions/pageManifests";
import {
  LangyUiActionService,
  type UiActionRedis,
} from "~/server/app-layer/langy/ui-actions/ui-action.service";
import { executeBackendAction } from "~/server/app-layer/langy/ui-actions/uiActionBackendExecutor";
import { bodyLimit } from "./_lib/body-limit";

const AUTH_REASON =
  "session key resolved in-handler by the API-key service + enforceApiKeyCeiling on the dispatched action's own permission, then bridged to the owning user by resolveLangyKeyIdentity";

/** An action payload is a small JSON document, never an upload. */
const MAX_ACTION_BODY_BYTES = 256 * 1024;

const uiActionAuth = handlerManagedAuth({
  reason: AUTH_REASON,
  permissions: ["experiments:view", "experiments:update", "evaluations:create"],
  credential: "apiKey",
});

const secured = createServiceApp({
  basePath: "/api/langy/ui",
  errorEnvelope: "canonical",
});

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

/**
 * Authenticate the key, open the flag, and resolve the owning user. Mirrors
 * `langy-api.ts`'s `authorizeTurn` including the dark-404 contract; the
 * permission ceiling is enforced by the caller once the action names it.
 */
async function authorizeUiRequest(c: Context) {
  const credentials = extractCredentials((name) => c.req.header(name));
  if (!credentials) throw new LangyApiCredentialMissingError();

  const resolved = await c.app.apiKeys.tryResolveToken({
    token: credentials.token,
    projectId: credentials.projectId,
  });
  if (!resolved) throw new LangyApiCredentialInvalidError();

  const surfaceOpen = await c.app.featureFlags.isEnabled("release_langy_ui_actions", {
    kind: "project",
    projectId: resolved.project.id,
    organizationId: resolved.project.organizationId,
  });
  if (!surfaceOpen) return { dark: true as const };

  const identity = await resolveLangyKeyIdentity({
    resolved,
    featureFlags: c.app.featureFlags,
  });
  if (!identity.ok) {
    throw new LangyApiIdentityDeniedError(
      identity.reason === "unowned" ? "langy_api_key_unowned" : "langy_api_key_no_langy_access",
      identity.message,
    );
  }

  return {
    dark: false as const,
    resolved,
    userId: identity.userId,
    projectId: resolved.project.id,
  };
}

function createService({
  app,
  context,
}: {
  app: App;
  context: {
    projectId: string;
    projectSlug: string;
    userId: string;
  };
}): LangyUiActionService {
  const redis = app.redis as unknown as UiActionRedis;
  return new LangyUiActionService({
    redis,
    conversations: {
      findByIdVisible: (args) => app.langy.tryFindByIdVisible(args),
    },
    buffer: LangyTokenBuffer.create({ redis: app.redis }),
    backendRunner: ({ kind, definition, payload, experimentSlug }) =>
      executeBackendAction({
        experiments: app.experiments,
        runServices: {
          evaluators: app.evaluators,
          modelProviders: app.modelProviders,
          nlpLambda: app.nlpLambda,
          workflows: app.workflows,
        },
        context: {
          ...context,
          experimentSlug,
          evaluationDefaultConcurrency: app.config.evaluationExecution.defaultConcurrency,
        },
        kind,
        definition,
        payload,
      }),
  });
}

secured
  .access(uiActionAuth)
  .post("/actions", bodyLimit({ maxSize: MAX_ACTION_BODY_BYTES }), async (c) => {
    const auth = await authorizeUiRequest(c);
    if (auth.dark) return c.notFound();

    const parsed = dispatchBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new LangyApiRequestInvalidError(parsed.error.issues);
    }
    const { conversationId, kind, payload, experimentSlug } = parsed.data;

    // The action's own permission is the key's ceiling for this dispatch.
    // Unknown kinds refuse before the ceiling so the error names the real
    // problem (the kind), not a permission the caller cannot reason about.
    const definition = findPageAction(kind);
    if (!definition) throw new LangyUiActionUnknownError(kind);
    await enforceApiKeyCeiling({
      resolved: auth.resolved,
      permission: definition.requiredPermission,
    });

    const outcome = await createService({
      app: c.app,
      context: {
        projectId: auth.projectId,
        projectSlug: auth.resolved.project.slug,
        userId: auth.userId,
      },
    }).dispatch({
      projectId: auth.projectId,
      userId: auth.userId,
      conversationId,
      kind,
      payload: payload ?? {},
      experimentSlug,
      notFound: () => new LangyConversationNotFoundError(conversationId),
    });
    return c.json(outcome, 200);
  });

secured.access(uiActionAuth).get("/actions", async (c) => {
  const auth = await authorizeUiRequest(c);
  if (auth.dark) return c.notFound();

  return c.json(
    {
      actions: listPageActions().map((action) => ({
        kind: action.kind,
        permission: action.requiredPermission,
        backend: action.backend,
        // Zod 4 renders its own JSON Schema; `zod-to-json-schema` only types
        // against zod 3. Pinned to draft-07 and inlined so the document the
        // CLI reads is the one this surface has always published.
        payloadSchema: z.toJSONSchema(action.payloadSchema, {
          target: "draft-07",
          reused: "inline",
        }),
      })),
    },
    200,
  );
});

export const app = secured.hono;
