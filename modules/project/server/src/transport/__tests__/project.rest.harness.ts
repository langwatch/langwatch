/**
 * `/api/projects` on a runtime standing in for the deployment, handed its
 * app through the SAME operations-only proxy the composition uses, so a
 * call the app doesn't serve fails here as it does in production.
 */
import {
  createRestRuntime,
  ForbiddenError,
  HttpError,
  UnauthorizedError,
  bindRestMiddleware,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import { LocalFeatureApis } from "@langwatch/runtime-composition";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { projectRest, projectRestCredential, ProjectManagementApi } from "../project.rest.ts";
import { TestProjectManagementApi } from "./support/test-project-management-api.ts";

export const ORGANIZATION_ID = "organization-1";
export const USER_ID = "user-1";
export const API_KEY_ID = "api-key-1";
export const CREDENTIAL = "organization-credential";

/** Every permission an organization credential holds unless a test narrows it. */
const EVERY_PERMISSION = [
  "project:create",
  "project:view",
  "project:update",
  "project:delete",
  "project:manage",
] as const;

/** The flat `{ error, message }` body this family has always published. */
const renderRefusal: RestErrorHandler = (error, c) => {
  if (error instanceof HttpError) {
    return c.json({ error: error.error, message: error.message }, error.status);
  }
  if (HandledError.isHandled(error)) {
    return c.json(
      { error: error.code, message: error.message },
      (error.httpStatus ?? 500) as ContentfulStatusCode,
    );
  }

  return c.json({ error: "Internal server error" }, 500);
};

/** What a test may narrow about the credential the door is reached with. */
export type ProjectRestAccess = {
  granted?: readonly string[];
  grantedOnProject?: Readonly<Record<string, readonly string[]>>;
};

/**
 * The family over one application boundary, stubbed operation by operation.
 * `granted` is what the credential holds at the organization;
 * `grantedOnProject` what it holds at a named project.
 */
export function mountProjectRest(
  options: ProjectRestAccess & { app?: Partial<ProjectManagementApi> } = {},
) {
  const { app, ...access } = options;

  return mountProjectRestApplication(new TestProjectManagementApi(app ?? {}), access);
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
    onError: renderRefusal,
    facts: [
      bindRestMiddleware(projectRestCredential, () => ({
        apiKeyId: API_KEY_ID,
        userId: USER_ID,
      })),
    ],
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
