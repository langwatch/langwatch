import type { Context, MiddlewareHandler } from "hono";
import { type App, getApp, tryGetApp } from "~/server/app-layer/app";

/**
 * The composed App is injected under its OWN key, never the bare `app` the
 * @langwatch/api pipeline uses for its per-request provider bag
 * (`{ ...BaseApp, ...providers }`). `createManagementService` mounts BOTH this
 * middleware and that pipeline, so sharing the key would let `appFromContext`
 * return the provider bag once the pipeline had set it — and
 * `.permissions.hasApiKeyPermission(...)` on a provider bag is a TypeError,
 * not the singleton fallback. Distinct keys keep the two apart.
 */
const APP_CONTEXT_KEY = "langwatchApp";

export type AppContextVariables = { [APP_CONTEXT_KEY]: App };

/**
 * Injects the composed App into the Hono context (`c.var.langwatchApp`).
 * Mounted by `SecuredApp` and the management-service factory, so every route
 * family's middlewares and handlers read the App from their request context
 * instead of resolving the singleton themselves.
 *
 * Injection tolerates absence (`tryGetApp`) so public routes on a family can
 * answer without an App; `appFromContext` is where absence becomes an error,
 * on the one path that actually needs a decision.
 */
export const appContextMiddleware: MiddlewareHandler = async (c, next) => {
  const app = tryGetApp();
  if (app) c.set(APP_CONTEXT_KEY, app);
  await next();
};

/**
 * The App this request decides through: the injected `c.var.langwatchApp`, or
 * the process singleton for handlers mounted outside the secured frameworks.
 * Both are the same instance in production — the context variable exists so
 * a test can hand in a fake without mocking the App module.
 */
export function appFromContext(c: Context): App {
  return (c.get(APP_CONTEXT_KEY) as App | undefined) ?? getApp();
}
