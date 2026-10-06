/**
 * The `/api/teams` family on a runtime standing in for the deployment,
 * reached through the SAME operations-only feature-API proxy production
 * uses, so a route naming an unserved operation fails here too.
 */
import {
  canonicalErrorResponse,
  bindRestMiddleware,
  createRestRuntime,
  ForbiddenError,
  UnauthorizedError,
} from "@langwatch/api/rest";
import { LocalFeatureApis } from "@langwatch/process";

import { organizationKeyFacts } from "../organization-management.rest.ts";
import { teamsRest, TeamManagementApi } from "../team.rest.ts";

export const ORGANIZATION_ID = "organization-1";
export const USER_ID = "user-owner";
export const CREDENTIAL = "organization-credential";
/** The organization key the credential resolves to, as organization.module.ts binds it. */
export const KEY_ID = "key-1";

/** Everything an organization credential holds here unless a test narrows it. */
export const EVERY_PERMISSION = ["team:view", "team:manage"] as const;

/**
 * What a viewer-scoped organization key holds over this family: nothing. A
 * VIEWER binding at the organization does not carry `team:view`, which is why
 * all four viewer scenarios in the spec expect 403 rather than a read.
 */
export const VIEWER_PERMISSIONS = [] as const;

/** What a test may narrow about the credential the door is reached with. */
export type TeamRestAccess = Readonly<{
  granted?: readonly string[];
  /** The credential's grant at a named team, where it differs from the organization grant. */
  grantedOnTeam?: Readonly<Record<string, readonly string[]>>;
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
      authorize: ({ permission, target }) => ({
        permitted: (options.grantedOnTeam?.[target.id] ?? [...granted]).includes(permission),
        organizationRole: null,
      }),
    },
  });

  const hono = runtime.mount(teamsRest.router(), {
    app: () => apis.reference(TeamManagementApi),
    onError: canonicalErrorResponse,
    facts: [bindRestMiddleware(organizationKeyFacts, () => ({ apiKeyId: KEY_ID }))],
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
