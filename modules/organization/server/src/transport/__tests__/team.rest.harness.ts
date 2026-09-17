/**
 * The `/api/teams` family on a runtime standing in for the deployment,
 * reached through the SAME operations-only feature-API proxy production
 * uses, so a route naming an unserved operation fails here too.
 */
import {
  createRestRuntime,
  ForbiddenError,
  UnauthorizedError,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import { LocalFeatureApis } from "@langwatch/kernel";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { teamsRest, TeamManagementApi } from "../team.rest.ts";

export const ORGANIZATION_ID = "organization-1";
export const USER_ID = "user-owner";
export const CREDENTIAL = "organization-credential";

/** Everything an organization credential holds here unless a test narrows it. */
export const EVERY_PERMISSION = ["team:view", "team:manage"] as const;

/**
 * What a viewer-scoped organization key holds over this family: nothing. A
 * VIEWER binding at the organization does not carry `team:view`, which is why
 * all four viewer scenarios in the spec expect 403 rather than a read.
 */
export const VIEWER_PERMISSIONS = [] as const;

/**
 * The canonical envelope `api-canonical-error.ts` renders for every mounted
 * family, including its deliberate rewrite of `validation_error` from 422 to
 * 400 — so the tests below assert what a caller really receives.
 */
const VALIDATION_ERROR_STATUS = 400;

const renderRefusal: RestErrorHandler = (error, c) => {
  if (HandledError.isHandled(error)) {
    const status = (
      error.code === "validation_error" ? VALIDATION_ERROR_STATUS : (error.httpStatus ?? 500)
    ) as ContentfulStatusCode;

    return status >= 500
      ? c.json({ status, code: "internal_error", message: "An unknown error occurred" }, status)
      : c.json({ status, code: error.code, message: error.message }, status);
  }

  const status = statusOf(error);
  if (status !== undefined) {
    return c.json({ status, code: codeOf(status), message: error.message }, status);
  }

  return c.json({ status: 500, code: "internal_error", message: "An unknown error occurred" }, 500);
};

/** The code a status-only refusal is published under, as the envelope names them. */
const CODE_BY_STATUS: Record<number, string> = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  422: "unprocessable_entity",
};

const codeOf = (status: number): string => CODE_BY_STATUS[status] ?? "internal_error";

const statusOf = (error: object): ContentfulStatusCode | undefined => {
  if (!("status" in error)) return void 0;
  const status = error.status;

  return typeof status === "number" && status >= 400 && status <= 599
    ? (status as ContentfulStatusCode)
    : void 0;
};

/** What a test may narrow about the credential the door is reached with. */
export type TeamRestAccess = Readonly<{
  granted?: readonly string[];
  /** The member the credential acts as, or `null` for a service key. */
  actor?: Readonly<{ type: "user"; id: string }> | null;
}>;

/**
 * The family over a WHOLE application — the one the composition builds, bound
 * to its module-API token and reached through the operations-only proxy,
 * exactly as `transport-mounting` does at boot.
 */
export function mountTeamsRestApplication(
  application: TeamManagementApi,
  options: TeamRestAccess = {},
) {
  const apis = new LocalFeatureApis();
  apis.declare(TeamManagementApi);
  apis.bind(TeamManagementApi, application);
  apis.ready();

  const granted = new Set<string>(options.granted ?? EVERY_PERMISSION);
  const actor =
    options.actor === undefined ? { type: "user" as const, id: USER_ID } : options.actor;

  /** The organization door: it authenticates, and refuses a credential it does not know. */
  const admit = (request: Request) => {
    if (request.headers.get("Authorization") !== `Bearer ${CREDENTIAL}`) {
      throw new UnauthorizedError("Invalid credential");
    }

    return {
      actor,
      scope: { tier: "organization", id: ORGANIZATION_ID } as const,
    };
  };

  const runtime = createRestRuntime({
    identity: {
      identify: ({ request }) => admit(request),
      authenticate: ({ request, permission }) => {
        const caller = admit(request);

        if (!granted.has(permission)) throw new ForbiddenError("Missing permission");

        return caller;
      },
      authorize: ({ permission }) => ({
        permitted: granted.has(permission),
        organizationRole: null,
      }),
    },
  });

  const hono = runtime.mount(teamsRest.router(), {
    app: () => apis.reference(TeamManagementApi),
    onError: renderRefusal,
  });

  const send = (
    path: string,
    init: { method?: string; body?: unknown; credential?: string | null } = {},
  ) =>
    hono.fetch(
      new Request(`http://api.test${path}`, {
        method: init.method ?? "GET",
        headers: {
          ...(init.credential === null
            ? {}
            : { Authorization: `Bearer ${init.credential ?? CREDENTIAL}` }),
          "Content-Type": "application/json",
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      }),
    );

  return { hono, send };
}

/** The refusal body every route in this family publishes. */
export type TeamRestRefusal = { status: number; code: string; message: string };
