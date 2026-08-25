import type { Context, MiddlewareHandler } from "hono";
import type { App } from "~/server/app-layer/app";

declare module "hono" {
  interface ContextVariableMap {
    langwatchApp: App;
  }

  interface Context {
    readonly app: App;
  }
}

/** Stable Hono variable key for middleware that cannot use `context.app`. */
const APP_CONTEXT_KEY = "langwatchApp";

export type AppContextVariables = { [APP_CONTEXT_KEY]: App };

/** Explicit bindings for an internal Hono re-dispatch. */
export type AppContextBindings = { [APP_CONTEXT_KEY]: App };

export function appContextBindingsFor(app: App): AppContextBindings {
  return { [APP_CONTEXT_KEY]: app };
}

function appFromBindings(c: Context): App | undefined {
  const bindings: unknown = c.env;
  if (!bindings || typeof bindings !== "object" || !(APP_CONTEXT_KEY in bindings)) {
    return undefined;
  }
  return bindings[APP_CONTEXT_KEY] as App;
}

function installAppContext(c: Context, app: App): void {
  c.set(APP_CONTEXT_KEY, app);
  Object.defineProperty(c, "app", {
    configurable: true,
    enumerable: false,
    value: app,
  });
}

/** Captures a process App for a transport root without consulting getApp(). */
export function appContextMiddlewareFor(app: App): MiddlewareHandler {
  return async (c, next) => {
    installAppContext(c, app);
    await next();
  };
}

/**
 * Injects the same process-composed App both as `context.app` for handlers and
 * as `c.var.langwatchApp` for existing middleware.
 * Mounted by `SecuredApp` and the management-service factory, so every route
 * family's middlewares and handlers read the App from their request context
 * instead of resolving the singleton themselves.
 *
 * The root router must already have installed the process App. Nested route
 * families never recover it from a global singleton.
 */
export const appContextMiddleware: MiddlewareHandler = async (c, next) => {
  const app = (c.get(APP_CONTEXT_KEY) as App | undefined) ?? appFromBindings(c);
  if (!app) {
    throw new Error(
      "Application context is missing. Mount the route below appContextMiddlewareFor(app).",
    );
  }
  installAppContext(c, app);
  await next();
};

/**
 * The process-owned App injected into this request by the transport root.
 */
export function appFromContext(c: Context): App {
  const app = c.get(APP_CONTEXT_KEY) as App | undefined;
  if (!app) {
    throw new Error(
      "Application context is missing. Mount the route below appContextMiddlewareFor(app).",
    );
  }
  return app;
}
