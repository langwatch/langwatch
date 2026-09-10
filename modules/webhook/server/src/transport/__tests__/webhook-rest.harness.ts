/**
 * The `/api/webhooks/v1` family on a runtime that stands in for the process:
 * one organization door, the canonical error envelope this family has always
 * published, and a pass-through idempotency ledger.
 */
import {
  apiErrorBody,
  createRestRuntime,
  type IdempotentRunner,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { WebhookApp, type WebhookAppDependencies } from "../../app/webhook.app.ts";
import { webhookRest } from "../webhook.rest.ts";

export const ORGANIZATION_ID = "organization-1";

/** Every dependency `WebhookApp` needs, defaulted to "not under test here". */
function unreachableDependencies(): WebhookAppDependencies {
  const unreachable = <T extends object>(name: string): T =>
    new Proxy({} as T, {
      get: () => (): never => {
        throw new Error(`${name} is not under test here`);
      },
    });

  return {
    endpoints: unreachable("endpoints"),
    health: { health: unreachable("health") },
    events: undefined,
    assertEndpointsEntitled: async () => undefined,
    dispatch: unreachable("dispatch"),
  };
}

/** The canonical `{ error: { code, message, ... } }` envelope this family publishes. */
const onError: RestErrorHandler = (error, c) => {
  if (HandledError.isHandled(error)) {
    const status =
      error.code === "validation_error" ? 400 : ((error.httpStatus ?? 500) as ContentfulStatusCode);
    return c.json(
      apiErrorBody({
        status: status as number,
        code: error.code,
        message: error.message,
        meta: error.meta,
        retryable: error.retryable,
      }),
      status,
    );
  }
  return c.json(apiErrorBody({ status: 500, code: "internal_error", message: String(error) }), 500);
};

/** Runs the create inline: no replay behaviour under test here. */
const passthroughIdempotency: IdempotentRunner = async ({ handler }) => {
  const response = await handler();
  return { isReplayed: false, status: response.status, response };
};

/** The family over one `WebhookAppDependencies` cut the test supplies. */
export function mountWebhookRest(dependencies: Partial<WebhookAppDependencies> = {}) {
  const app = WebhookApp.create({ ...unreachableDependencies(), ...dependencies });

  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({
        actor: { type: "api_key", id: "webhook-key" },
        scope: { tier: "organization", id: ORGANIZATION_ID },
      }),
    },
    idempotency: passthroughIdempotency,
  });

  const hono = runtime.mount(webhookRest.router(), {
    app: () => app,
    onError,
  });

  return {
    hono,
    request: (path: string, init: RequestInit = {}) =>
      hono.request(`http://api.test${path}`, {
        headers: { "Content-Type": "application/json" },
        ...init,
      }),
  };
}
