import type { Context, MiddlewareHandler } from "hono";
import { type App, getApp, tryGetApp } from "~/server/app-layer/app";

export type AppContextVariables = { app: App };

/**
 * Injects the composed App into the Hono context (`c.var.app`). Mounted by
 * `SecuredApp` and the management-service factory, so every route family's
 * middlewares and handlers read the App from their request context instead of
 * resolving the singleton themselves.
 *
 * Injection tolerates absence (`tryGetApp`) so public routes on a family can
 * answer without an App; `appFromContext` is where absence becomes an error,
 * on the one path that actually needs a decision.
 */
export const appContextMiddleware: MiddlewareHandler = async (c, next) => {
  const app = tryGetApp();
  if (app) c.set("app", app);
  await next();
};

/**
 * The App this request decides through: the injected `c.var.app`, or the
 * process singleton for handlers mounted outside the secured frameworks.
 * Both are the same instance in production — the context variable exists so
 * a test can hand in a fake without mocking the App module.
 */
export function appFromContext(c: Context): App {
  return (c.get("app") as App | undefined) ?? getApp();
}
