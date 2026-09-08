/**
 * Binds the public stored-object RPC declaration to this process's credential
 * boundary. The family answers `/api/stored-objects/2026-08-22/...` for a
 * project API key.
 */
import {
  createRestRuntime,
  type MountableRestApp,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import type { StoredObjectApi } from "@langwatch/stored-object-contract";
import { storedObjectRest } from "@langwatch/stored-object-server";
import type { MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { ApiHandlerManagedCredentialPort } from "../../app-rest/app-rest.process-features.ts";

class StoredObjectRefusal extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly body: object,
  ) {
    super("stored-object request refused");
    this.name = "StoredObjectRefusal";
  }
}

export function mountStoredObjectRest(options: {
  storedObjects: () => StoredObjectApi;
  credential: ApiHandlerManagedCredentialPort;
}): MountableRestApp {
  const runtime = createRestRuntime({
    identity: {
      authenticate: async ({ request, permission }) => {
        const credential = await options.credential({ request, permission });
        if (!credential.ok) throw new StoredObjectRefusal(credential.status, credential.body);

        return {
          actor: null,
          scope: { tier: "project", id: credential.project.id },
          markUsed: credential.markUsed,
        };
      },
    },
  });

  return runtime.mount(storedObjectRest.router(), {
    app: options.storedObjects,
    credential: "projectKey",
    onError: storedObjectErrorHandler,
    middleware: [noStore],
  });
}

/** Delivery capabilities are short-lived and per-caller: no cache may hold one. */
const noStore: MiddlewareHandler = async (context, next) => {
  await next();
  context.header("Cache-Control", "private, no-store");
};

/** Every refusal these routes raise, in the body the feature's errors carry. */
const storedObjectErrorHandler: RestErrorHandler = (error, context) => {
  if (error instanceof StoredObjectRefusal) return context.json(error.body, error.status);

  if (HandledError.isHandled(error)) {
    return context.json(error.serialize(), error.httpStatus as ContentfulStatusCode);
  }

  return context.json({ status: "error", message: "Internal server error." }, 500);
};
