/**
 * The `/api/experiments` family on a runtime that stands in for the process:
 * one project door, the credential fact its create is attributed through, and
 * the flat legacy envelope this family publishes.
 */
import {
  bindRestMiddleware,
  createRestRuntime,
  ForbiddenError,
  HttpError,
  UnauthorizedError,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import type { ExperimentApi } from "@langwatch/experiment-contract";
import { HandledError } from "@langwatch/handled-error";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { experimentRest, experimentRestCredential } from "../experiment.rest.ts";

export const PROJECT_ID = "project-1";
export const CALLER_USER_ID = "user-caller";

/** A scoped key acting as a member, and a legacy key acting as nobody. */
export const AS_MEMBER = "member-credential";
export const AS_LEGACY_KEY = "legacy-project-credential";

/** The member a presented credential acts as, or `undefined` for one nobody issued. */
function callerOf(request: Request): string | null | undefined {
  const presented = request.headers.get("Authorization")?.replace(/^Bearer /, "");
  if (presented === AS_MEMBER) return CALLER_USER_ID;
  if (presented === AS_LEGACY_KEY) return null;

  return undefined;
}

/** The flat body this family has always published on a refusal. */
const renderRefusal: RestErrorHandler = (error, c) => {
  if (HandledError.isHandled(error)) {
    return c.json(
      { error: error.code, message: error.message },
      (error.httpStatus ?? 500) as ContentfulStatusCode,
    );
  }
  if (error instanceof HttpError) {
    return c.json({ error: error.error, message: error.message }, error.status);
  }

  return c.json({ error: "Internal server error" }, 500);
};

/**
 * An `ExperimentApi` that answers only what a test stubbed; any other member a
 * handler reaches fails loudly rather than answering `undefined`.
 */
export function stubExperimentApi(stubs: Partial<ExperimentApi>): ExperimentApi {
  return new Proxy({} as ExperimentApi, {
    get(_target, property) {
      const stubbed: unknown = Reflect.get(stubs, property);
      if (stubbed !== undefined) return stubbed;

      return () => {
        throw new Error(`ExperimentApi.${String(property)} was not stubbed by this test`);
      };
    },
  });
}

/** Every permission the door grants unless a test narrows the set. */
const EVERY_GRANT = ["experiments:view", "experiments:create"] as const;

/** The family over one experiment application the test may stub method by method. */
export function mountExperimentRest(
  options: {
    app?: Partial<ExperimentApi>;
    granted?: readonly string[];
    /** Records what the door checked, in the order it checked it. */
    checked?: string[];
  } = {},
) {
  const app = stubExperimentApi(options.app ?? {});
  const granted = new Set<string>(options.granted ?? EVERY_GRANT);
  const checked = options.checked ?? [];

  const runtime = createRestRuntime({
    identity: {
      authenticate: ({ request, permission }) => {
        checked.push(`authenticate`);
        const userId = callerOf(request);
        if (userId === undefined) throw new UnauthorizedError("Invalid credential");
        checked.push(`authorize:${permission}`);
        if (!granted.has(permission)) throw new ForbiddenError("Missing permission");

        return {
          actor: userId ? { type: "user", id: userId } : { type: "api_key", id: "key-1" },
          scope: { tier: "project", id: PROJECT_ID },
        };
      },
    },
  });

  const hono = runtime.mount(experimentRest.router(), {
    app: () => app,
    onError: renderRefusal,
    facts: [
      bindRestMiddleware(experimentRestCredential, (c) => {
        const userId = callerOf(c.req.raw);

        return userId === null
          ? { kind: "legacyProjectKey" as const }
          : { kind: "apiKey" as const, userId: userId ?? null };
      }),
    ],
  });

  const send = (path: string, init: { method?: string; body?: unknown; as?: string } = {}) =>
    hono.fetch(
      new Request(`http://api.test${path}`, {
        method: init.method ?? "GET",
        headers: {
          Authorization: `Bearer ${init.as ?? AS_MEMBER}`,
          "Content-Type": "application/json",
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      }),
    );

  return { hono, send, checked };
}
