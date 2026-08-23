import type { AgentService as AgentServiceContract } from "@langwatch/agents-contract";
import type { PermissionsService } from "~/server/app-layer/permissions/permissions.service";
import { AgentsFeature, type AgentsRuntimeContext } from "./features/agents";

export type RequestAppServices = {
  agents: AgentServiceContract;
  permissions: PermissionsService;
};

/**
 * The request-scoped application seen by transports.
 *
 * Composition happens once while the request context is created. Routers use
 * the already-instantiated services on `ctx.app`; tests can pass a small
 * `RequestAppServices` fake without constructing runtime infrastructure.
 */
export class RequestApp implements RequestAppServices {
  static create(
    context: AgentsRuntimeContext & { permissions: PermissionsService },
  ): RequestApp {
    return new RequestApp(AgentsFeature.create(context), context.permissions);
  }

  private constructor(
    readonly agents: AgentServiceContract,
    readonly permissions: PermissionsService,
  ) {}
}
