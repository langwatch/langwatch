/**
 * Binds the api-keys REST declaration to this process's organization door,
 * with the two management audit rows the family has always written: reading
 * one key by id and updating one both name people.
 */
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import { apiKeyRest, apiKeyRestCredential } from "@langwatch/api-key-server";
import {
  bindRestMiddleware,
  type AppRestManagementAuditPort,
  type MountableRestApp,
} from "@langwatch/api/rest";
import type { MiddlewareHandler } from "hono";

import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";

/** The two addressed routes that leave a trail, by the method that reaches them. */
const AUDITED_ACTIONS = {
  GET: "management.apiKey.read",
  PATCH: "management.apiKey.update",
} as const;

/** A dated or `latest` path segment, which addresses no key. */
const VERSION_SEGMENT = /^(latest|20\d{2}-\d{2}-\d{2})$/;

/** Mounts `/api/api-keys` behind this process's organization credential. */
export function mountApiKeyRest(
  runtime: ApiRestRuntime,
  options: Readonly<{ apiKeys: () => ApiKeyApi; audit: AppRestManagementAuditPort }>,
): MountableRestApp {
  return runtime.mount(apiKeyRest.router(), options.apiKeys, {
    // The credential itself, not just its holder: two of these routes ask
    // whether the KEY may act organization-wide as well as whether the member
    // may, so a narrowed key cannot borrow the reach of whoever created it.
    facts: [
      bindRestMiddleware(apiKeyRestCredential, (context) => {
        const credential = runtime.organizationCredentialOf(context.req.raw);

        return { apiKeyId: credential.apiKeyId, userId: credential.userId };
      }),
    ],
    middleware: [recordApiKeyManagementAudit(runtime, options.audit)],
  });
}

/**
 * Emitted after the answer, and only for one that succeeded: a refusal
 * disclosed nothing and changed nothing, so recording it would report a read
 * that never happened.
 */
function recordApiKeyManagementAudit(
  runtime: ApiRestRuntime,
  audit: AppRestManagementAuditPort,
): MiddlewareHandler {
  return async (context, next) => {
    await next();

    if (context.res.status < 200 || context.res.status >= 300) return;

    const action = actionOf(context.req.method);
    const apiKeyId = addressedApiKeyId(context.req.path);

    if (!action || !apiKeyId) return;

    const credential = runtime.organizationCredentialOf(context.req.raw);

    audit({
      // The member the credential acts as; a service key acts as nobody, so it
      // is recorded as one stable string per credential instead.
      userId: credential.userId ?? `apikey:${credential.apiKeyId}`,
      organizationId: credential.organizationId,
      action,
      args: { apiKeyId },
    });
  };
}

function actionOf(method: string): (typeof AUDITED_ACTIONS)[keyof typeof AUDITED_ACTIONS] | null {
  if (method === "GET") return AUDITED_ACTIONS.GET;
  if (method === "PATCH") return AUDITED_ACTIONS.PATCH;

  return null;
}

/**
 * The key id this request addressed, or none where it addressed the collection.
 * Read off the path because the family answers at three of them per generation
 * — dated, `latest` and bare — each with its `/api/v1` twin.
 */
function addressedApiKeyId(path: string): string | null {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  const namespace = segments.indexOf("api-keys");

  if (namespace < 0) return null;

  const addressed = segments
    .slice(namespace + 1)
    .filter((segment) => !VERSION_SEGMENT.test(segment));

  return addressed.length === 1 ? (addressed[0] ?? null) : null;
}
