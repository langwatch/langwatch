import { AuthenticatedActorRequiredError, type RequestActor } from "@langwatch/api";
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { Context, MiddlewareHandler } from "hono";
import type { ApiActor } from "./api.application";

/** One project credential resolved at the API process's REST boundary. */
export type ApiRestAuthenticatedRequest = Readonly<{
  projectId: string;
  actor: ApiActor | null;
}>;

/** One successful REST response observed after all route middleware completes. */
export type ApiRestSuccessfulResponse = Readonly<{
  request: ApiRestAuthenticatedRequest;
  method: string;
  path: string;
  status: number;
}>;

/**
 * Process-owned REST authentication and permission enforcement.
 *
 * The eventual production adapter owns credential parsing, project selection,
 * API-key ceilings, and delegation to AuthZ. Feature REST adapters only see
 * the already-authenticated project, actor, and declared permission.
 */
export abstract class ApiRestSecurityPort {
  abstract authenticate(request: Request): Promise<ApiRestAuthenticatedRequest>;

  abstract authorize(input: {
    request: ApiRestAuthenticatedRequest;
    permission: AuthzPermission;
  }): Promise<void>;

  abstract complete(input: ApiRestSuccessfulResponse): Promise<void>;
}

/** Bridges the process REST security port into the package REST pipeline. */
export class ApiRestSecurityPolicy {
  static create(port: ApiRestSecurityPort): ApiRestSecurityPolicy {
    return new ApiRestSecurityPolicy(port);
  }

  private readonly requests = new WeakMap<Context, ApiRestAuthenticatedRequest>();
  private readonly completed = new WeakSet<Context>();

  private constructor(private readonly port: ApiRestSecurityPort) {}

  authenticationMiddleware(): MiddlewareHandler {
    return async (context, next) => {
      const request = await this.port.authenticate(context.req.raw);
      this.requests.set(context, request);
      context.set("project", { id: request.projectId });
      await next();
      if (context.res.status >= 200 && context.res.status < 300) {
        await this.complete(context, request);
      }
    };
  }

  actor(context: Context): RequestActor {
    const actor = this.request(context).actor;
    if (!actor) {
      throw new AuthenticatedActorRequiredError();
    }
    return actor;
  }

  authorize(context: Context, permission: AuthzPermission): Promise<void> {
    return this.port.authorize({ request: this.request(context), permission });
  }

  permissionMiddleware(permission: AuthzPermission): MiddlewareHandler {
    return async (context, next) => {
      await this.authorize(context, permission);
      await next();
    };
  }

  private request(context: Context): ApiRestAuthenticatedRequest {
    const request = this.requests.get(context);
    if (!request) {
      throw new Error("REST authentication must run before API request security is used.");
    }
    return request;
  }

  private async complete(context: Context, request: ApiRestAuthenticatedRequest): Promise<void> {
    if (this.completed.has(context)) {
      return;
    }
    this.completed.add(context);
    await this.port.complete({
      request,
      method: context.req.method,
      path: context.req.path,
      status: context.res.status,
    });
  }
}
