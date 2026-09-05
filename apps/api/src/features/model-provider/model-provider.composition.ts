/**
 * The model providers a tenant attaches, composed as their own feature.
 */
import {
  declareAuthzMiddleware,
  type AuthzPermission,
  type AuthzService,
} from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import {
  ModelProviderApp,
  type LlmModelCostTrpcPorts,
  type ModelProviderTrpcPorts,
  type TranslateTrpcPorts,
} from "@langwatch/model-provider-server";
import type { Logger } from "@langwatch/observability";
import type { TraceAppDependencies } from "@langwatch/trace-server";

import type { ApiTrpcFeatureMount } from "../../api.application";
import type { ApiTrpcInfrastructure } from "../../platform/infrastructure/api-trpc.infrastructure";
import {
  createLlmModelCostTrpcRouter,
  createModelProviderTrpcRouter,
  type ModelProviderTrpcChecks,
} from "./model-provider-trpc.mount";
import { createTranslateTrpcRouter } from "./translate-trpc.mount";

/**
 * The model-provider capabilities that reach OUTSIDE this process: the vendor
 * credential probes, the Codex device flow, the span preview behind a cost
 * rule, the model registry's ceilings and the catastrophic-backtracking gate.
 */
export abstract class ApiModelProviderHostPort {
  abstract probes(): Pick<
    ModelProviderTrpcPorts,
    | "validateProviderApiKey"
    | "validateKeyWithCustomUrl"
    | "startCodexDeviceSignIn"
    | "pollCodexDeviceSignIn"
  >;
  abstract costRules(): LlmModelCostTrpcPorts;
  /** The provider-failure policy one translation call is wrapped in. */
  abstract translate(): TranslateTrpcPorts;
}

/** Reports each absence, with what it costs. */
export abstract class ApiModelProviderAbsenceReport {
  abstract absent(capability: "model-provider-host" | "gateway"): void;
}

/** Writes each absence to the process log, once, at composition time. */
export class LoggedApiModelProviderAbsence extends ApiModelProviderAbsenceReport {
  static create(logger: Pick<Logger, "warn">): LoggedApiModelProviderAbsence {
    return new LoggedApiModelProviderAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  absent(capability: "model-provider-host" | "gateway"): void {
    this.logger.warn({ capability }, CONSEQUENCE[capability]);
  }
}

const CONSEQUENCE = {
  "model-provider-host":
    "API process composed no provider host: credential probes and the Codex device flow refuse, and a cost rule's span preview reports no matches.",
  gateway:
    "API process composed no provider gateway: every stored-credential read and write refuses by name, because this process holds no cipher to read one with.",
} as const;

/** The other features' services the provider surface reads. */
export type ModelProviderPeers = Readonly<{
  /**
   * The span reader a cost rule's preview matches against, carried through the
   * application untouched: this process only knows its concrete type where it
   * composed a trace read stack.
   */
  spans?: TraceAppDependencies["traces"]["spans"];
}>;

/** The three namespaces and the `ctx.app.modelProviders` slice. */
export type ComposedModelProviderFeature = Readonly<{
  routers(mount: ApiTrpcFeatureMount): {
    modelProvider: ReturnType<typeof createModelProviderTrpcRouter>;
    llmModelCost: ReturnType<typeof createLlmModelCostTrpcRouter>;
    translate: ReturnType<typeof createTranslateTrpcRouter>;
  };
  /** For `ctx.app.modelProviders`. */
  app: ModelProviderApp;
}>;

/** Composes the provider surfaces over this process's own graph. */
export function composeModelProviderFeature(options: {
  infrastructure: ApiTrpcInfrastructure;
  peers?: ModelProviderPeers;
  /** The gateway this process composed, or none where it holds no cipher. */
  modelProviders?: ModelProviderService;
  /** The vendor probes and cost-rule preview; absent refuses each. */
  host?: ApiModelProviderHostPort;
  report?: ApiModelProviderAbsenceReport;
}): ComposedModelProviderFeature {
  if (!options.host) options.report?.absent("model-provider-host");
  if (!options.modelProviders) options.report?.absent("gateway");

  const app = ModelProviderApp.create({
    modelProviders:
      options.modelProviders ?? refusing<ModelProviderService>("the provider gateway"),
    // Always passed, `undefined` included: the cost-rule preview's span reader
    // is the trace read stack's, and a process that composed none has no
    // reader to hand over rather than a different one.
    spans: options.peers?.spans,
  });

  return {
    app,
    routers: (mount) =>
      buildRouters({
        mount,
        authz: options.infrastructure.authz,
        probes: options.host?.probes() ?? refusing("the provider credential probe"),
        costRules: options.host?.costRules() ?? conservativeCostRules(),
        translate: options.host?.translate() ?? { wrapAiCall: (_feature, call) => call() },
      }),
  };
}

/**
 * The provider surfaces on a process that composed no database. All three namespaces
 * still mount and every call refuses by name, so the settings screen says the deployment
 * cannot answer rather than reporting that a tenant has attached no providers.
 */
export function refusingModelProviderFeature(): ComposedModelProviderFeature {
  return {
    app: refusing<ModelProviderApp>("the provider gateway"),
    routers: (mount) =>
      buildRouters({
        mount,
        authz: refusing<AuthzService>("the permission service"),
        probes: refusing("the provider credential probe"),
        costRules: conservativeCostRules(),
        translate: { wrapAiCall: (_feature, call) => call() },
      }),
  };
}

/** The three routers, over whatever this deployment could answer with. */
function buildRouters(options: {
  mount: ApiTrpcFeatureMount;
  authz: AuthzService;
  probes: ReturnType<ApiModelProviderHostPort["probes"]>;
  costRules: LlmModelCostTrpcPorts;
  translate: TranslateTrpcPorts;
}) {
  const { mount } = options;
  const ports = {
    ...options.probes,
    // Fire and forget, as the router has always done: a connect is recorded,
    // but a slow audit write never holds up the sign-in response.
    recordAudit: () => undefined,
  } as ModelProviderTrpcPorts<unknown, unknown>;

  return {
    modelProvider: createModelProviderTrpcRouter({
      ...mount,
      ports,
      checks: modelProviderChecks(options.authz),
    }),
    llmModelCost: createLlmModelCostTrpcRouter({ ...mount, ports: options.costRules }),
    translate: createTranslateTrpcRouter({ ...mount, ports: options.translate }),
  };
}

/**
 * The two data-dependent gates the provider surface authorizes through.
 */
function modelProviderChecks(authz: AuthzService): ModelProviderTrpcChecks {
  const probe =
    (permission: AuthzPermission) =>
    async (params: {
      ctx: { actor(): { id: string }; permissionChecked?: boolean };
      input: { projectId?: string; organizationId?: string };
      next(): unknown;
    }) => {
      const scope = params.input.projectId
        ? { projectId: params.input.projectId }
        : { organizationId: params.input.organizationId ?? "" };
      const permitted = await authz.hasPermission({
        userId: params.ctx.actor().id,
        permission,
        ...scope,
      });
      if (!permitted) throw new ProviderTenantDeniedError(permission);
      params.ctx.permissionChecked = true;
      return params.next();
    };

  return {
    tenantWrite: (permission) =>
      declareAuthzMiddleware(
        {
          kind: "custom",
          reason:
            "the tenant anchor is data-dependent: a project when one is named, otherwise the organization the provider belongs to",
          permissions: [permission, "organization:view"],
        },
        async (params: never) => {
          const call = params as unknown as Parameters<ReturnType<typeof probe>>[0];
          return call.input.projectId ? probe(permission)(call) : probe("organization:view")(call);
        },
      ),
    credentialProbe: declareAuthzMiddleware(
      {
        kind: "custom",
        reason:
          "the credential probe goes straight out to the vendor with caller-supplied keys, so this gate IS the authorization rather than a coarse pre-filter",
        permissions: ["project:update", "organization:manage"],
      },
      async (params: never) => {
        const call = params as unknown as Parameters<ReturnType<typeof probe>>[0];
        return call.input.projectId
          ? probe("project:update")(call)
          : probe("organization:manage")(call);
      },
    ),
  };
}

/** The caller may not write providers at the tenant they named. */
class ProviderTenantDeniedError extends HandledError {
  declare readonly code: "permission_denied";

  constructor(permission: AuthzPermission) {
    super("permission_denied", "You do not have permission to manage model providers here", {
      httpStatus: 403,
      fault: "customer",
      meta: { permission },
    });
    this.name = "ProviderTenantDeniedError";
  }
}

/**
 * The cost-rule ports for a process with no provider host.
 */
function conservativeCostRules(): LlmModelCostTrpcPorts {
  const nestedQuantifier = /\([^)]*[+*][^)]*\)\s*[+*]/;
  return {
    isSafeRegex: (pattern) => !nestedQuantifier.test(pattern),
    tryGetModelLimits: () => null,
    previewMatchingSpans: () =>
      Promise.reject(new ApiModelProviderUnavailableError("the cost rule's span preview")),
  };
}

/** A stand-in whose every member refuses by name. */
function refusing<T>(capability: string): T {
  return new Proxy(
    {},
    {
      get: () => (): never => {
        throw new ApiModelProviderUnavailableError(capability);
      },
      has: () => true,
    },
  ) as T;
}

/** A capability this deployment did not compose, refused by name. */
class ApiModelProviderUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", "This part of the product is not available on this deployment", {
      httpStatus: 503,
      fault: "platform",
      meta: { capability },
    });
    this.name = "ApiModelProviderUnavailableError";
  }
}
