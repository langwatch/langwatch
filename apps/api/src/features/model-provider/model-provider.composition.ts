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

import type { ApiTrpcFeatureMount } from "../../api.application.ts";
import type { ApiTrpcInfrastructure } from "../../platform/infrastructure/api-trpc.infrastructure.ts";

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

import type { ComposedModelProviderFeature } from "./model-provider.composition.types.ts";

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

  // The three namespaces, their ports and the two data-dependent gates went
  // with the transports that took them; they return with the converted ones.
  return { app };
}

/**
 * The provider surfaces on a process that composed no database. All three namespaces
 * still mount and every call refuses by name, so the settings screen says the deployment
 * cannot answer rather than reporting that a tenant has attached no providers.
 */
export function refusingModelProviderFeature(): ComposedModelProviderFeature {
  return { app: refusing<ModelProviderApp>("the provider gateway") };
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
