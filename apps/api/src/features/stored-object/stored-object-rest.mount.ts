/**
 * Binds the public stored-object RPC declaration to this process's credential
 * boundary. The family answers `/api/stored-objects/2026-08-22/...` for a
 * project API key.
 */
import type { MountableRestApp, RestErrorHandler } from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import type { StoredObjectApi } from "@langwatch/stored-object-contract";
import { storedObjectRest } from "@langwatch/stored-object-server";
import type { MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";

/** `/api/stored-objects/2026-08-22/*`, on this process's project-key door. */
export function mountStoredObjectRest(
  runtime: ApiRestRuntime,
  storedObjects: () => StoredObjectApi,
): MountableRestApp {
  return runtime.mount(storedObjectRest.router(), storedObjects, {
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
  if (HandledError.isHandled(error)) {
    return context.json(error.serialize(), error.httpStatus as ContentfulStatusCode);
  }

  return context.json({ status: "error", message: "Internal server error." }, 500);
};
