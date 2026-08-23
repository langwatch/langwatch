import type { AgentService as AgentServiceContract } from "@langwatch/agents-contract";
import type {
  AuthzGrantsService,
  AuthzService,
} from "@langwatch/authz-contract";
import { AgentsFeature, type AgentsRuntimeContext } from "./features/agents";

export type RequestAppServices = {
  agents: AgentServiceContract;
  permissions: AuthzService;
  authzGrants: AuthzGrantsService;
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
    context: AgentsRuntimeContext & {
      permissions: AuthzService;
      authzGrants: AuthzGrantsService;
    },
  ): RequestApp {
    return new RequestApp(
      AgentsFeature.create(context),
      context.permissions,
      context.authzGrants,
    );
  }

  private constructor(
    readonly agents: AgentServiceContract,
    readonly permissions: AuthzService,
    readonly authzGrants: AuthzGrantsService,
  ) {}
}
