/**
 * `/api/projects` on a runtime standing in for the deployment, handed its
 * app through the SAME operations-only proxy the composition uses, so a
 * call the app doesn't serve fails here as it does in production.
 */
import {
  bindRestMiddleware,
  createRestRuntime,
  canonicalErrorResponse,
  ForbiddenError,
  UnauthorizedError,
} from "@langwatch/api/rest";
import { LocalFeatureApis } from "@langwatch/process";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";

import { projectRest, projectRestCaller, ProjectManagementApi } from "../project.rest.ts";
import { TestProjectManagementApi } from "./support/test-project-management-api.ts";

export const ORGANIZATION_ID = "organization-1";
export const USER_ID = "user-1";
export const CREDENTIAL = "organization-credential";
export const API_KEY_ID = "api-key-1";

/** Every permission an organization credential holds unless a test narrows it. */
const EVERY_PERMISSION = [
  "project:view",
  "project:update",
  "project:delete",
  "project:manage",
] as const;

/** What a test may narrow about the credential the door is reached with. */
export type ProjectRestAccess = {
  granted?: readonly string[];
  grantedOnProject?: Readonly<Record<string, readonly string[]>>;
};

/**
 * The family over one application boundary, stubbed operation by operation.
 * `granted` is the credential's organization grant, `grantedOnProject` its
 * grant at a named project. The PII level reads ESSENTIAL unless overridden.
 */
export function mountProjectRest(
  options: ProjectRestAccess & { app?: Partial<ProjectManagementApi> } = {},
) {
  const { app, ...access } = options;

  return mountProjectRestApplication(
    new TestProjectManagementApi({
      getPiiRedactionLevel: async () => "ESSENTIAL",
      // The aggregate guard reads the row first; an unstubbed read finds an ordinary project.
      findWithTeam: async () => null,
      ...app,
    }),
    access,
  );
}

/**
 * The same family over a WHOLE application — the one the composition builds,
 * bound to its module-API token and reached through the operations-only proxy,
 * exactly as `transport-mounting` does at boot.
 */
export function mountProjectRestApplication(
  application: ProjectManagementApi,
  options: ProjectRestAccess = {},
) {
  const apis = new LocalFeatureApis();
  apis.declare(ProjectManagementApi);
  apis.bind(ProjectManagementApi, application);
  apis.ready();
  const granted = new Set<string>(options.granted ?? EVERY_PERMISSION);
  const grantedOnProject = options.grantedOnProject;

  /** The organization door: it authenticates, and refuses a credential it does not know. */
  const admit = (request: Request) => {
    if (request.headers.get("Authorization") !== `Bearer ${CREDENTIAL}`) {
      throw new UnauthorizedError("Invalid credential");
    }

    return {
      actor: { type: "user", id: USER_ID } as const,
      scope: { tier: "organization", id: ORGANIZATION_ID } as const,
    };
  };

  const runtime = createRestRuntime({
    audit: { record: async () => {} },
    authorization: restTestAuthorization(),
    identity: {
      identify: ({ request }) => admit(request),
      authenticate: ({ request, permission }) => {
        const caller = admit(request);

        if (!granted.has(permission)) throw new ForbiddenError("Missing permission");

        return caller;
      },
      authorize: ({ permission, target }) => ({
        permitted: (grantedOnProject?.[target.id] ?? [...granted]).includes(permission),
        organizationRole: null,
      }),
    },
  });

  const hono = runtime.mount(projectRest.router(), {
    app: () => apis.reference(ProjectManagementApi),
    facts: [
      bindRestMiddleware(projectRestCaller, () => ({ userId: USER_ID, apiKeyId: API_KEY_ID })),
    ],
    onError: canonicalErrorResponse,
  });

  const send = (
    path: string,
    init: { method?: string; body?: unknown; credential?: string } = {},
  ) =>
    hono.fetch(
      new Request(`http://api.test${path}`, {
        method: init.method ?? "GET",
        headers: {
          Authorization: `Bearer ${init.credential ?? CREDENTIAL}`,
          "Content-Type": "application/json",
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      }),
    );

  return { hono, send };
}
