/**
 * Binds the two dashboard REST declarations to this process's credential
 * boundary.
 *
 * `/api/dashboards` and `/api/graphs` are one application seen twice, so they
 * travel together: a process holding the dashboards but not the graphs would
 * publish a dashboard whose panels cannot be read.
 */
import {
  createRestRuntime,
  type MountableRestApp,
  type RequestValidationError,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import {
  DashboardNotFoundError,
  DashboardReorderUnknownIdsError,
  GraphNotFoundError,
  type DashboardApi,
} from "@langwatch/dashboard-contract";
import { dashboardRest, graphRest } from "@langwatch/dashboard-server";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { ApiHandlerManagedCredentialPort } from "../../app-rest/app-rest.process-features.ts";

class DashboardRefusal extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly body: object,
  ) {
    super("dashboard request refused");
    this.name = "DashboardRefusal";
  }
}

/** Mounts `/api/dashboards` and `/api/graphs` with their historical bodies. */
export function mountDashboardRest(options: {
  dashboard: () => DashboardApi;
  credential: ApiHandlerManagedCredentialPort;
}): MountableRestApp[] {
  const runtime = createRestRuntime({
    identity: {
      authenticate: async ({ request, permission }) => {
        const credential = await options.credential({ request, permission });
        if (!credential.ok) throw new DashboardRefusal(credential.status, credential.body);

        return {
          actor: null,
          scope: { tier: "project", id: credential.project.id },
          markUsed: credential.markUsed,
        };
      },
    },
  });

  return [
    runtime.mount(dashboardRest.router(), {
      app: options.dashboard,
      credential: "projectKey",
      onError: dashboardErrorHandler,
    }),
    runtime.mount(graphRest.router(), {
      app: options.dashboard,
      credential: "projectKey",
      onError: graphErrorHandler,
    }),
  ];
}

/**
 * The dashboards family's refusals, in the bodies it has always answered with.
 *
 * A reorder naming ids that are not there answers 400 here and 404 on the tRPC
 * surface. That disagreement predates this mount and is left exactly as it
 * was: reconciling it changes a published status.
 */
const dashboardErrorHandler: RestErrorHandler = (error, context) => {
  if (error instanceof DashboardRefusal) return context.json(error.body, error.status);

  if (error instanceof DashboardReorderUnknownIdsError) {
    return context.json({ error: error.message }, 400);
  }

  if (error instanceof DashboardNotFoundError) {
    return context.json({ error: "Dashboard not found" }, 404);
  }

  if (isRequestValidationError(error)) return validationFailure(context, error);

  return context.json({ error: "Internal server error" }, 500);
};

/** The graphs family's own refusals, in the bare `{ error }` body they had. */
const graphErrorHandler: RestErrorHandler = (error, context) => {
  if (error instanceof DashboardRefusal) return context.json(error.body, error.status);

  if (error instanceof GraphNotFoundError) return context.json({ error: "Graph not found" }, 404);

  if (error instanceof DashboardNotFoundError) {
    return context.json({ error: "Dashboard not found" }, 404);
  }

  if (isRequestValidationError(error)) return validationFailure(context, error);

  return context.json({ error: "Internal server error" }, 500);
};

function isRequestValidationError(error: unknown): error is RequestValidationError {
  return error instanceof Error && error.name === "RequestValidationError";
}

/** A rejected body stays a 422, as the shared validation envelope answers. */
function validationFailure(context: Context, error: RequestValidationError): Response {
  return context.json({ error: error.message, meta: error.meta }, 422);
}
