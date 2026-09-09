/**
 * The model providers a tenant attaches, composed as their own feature.
 */
import { AuthzApi } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import {
  CodexAccountService,
  HttpModelProviderCredentialProbeAdapter,
  modelProviderServer,
  SsrfModelProviderEgressAdapter,
  type ModelProviderApp,
} from "@langwatch/model-provider-server";
import { OrganizationApi } from "@langwatch/organization-contract";
import { ProjectApi } from "@langwatch/project-contract";
import { createApp } from "@langwatch/runtime-composition";
import type { TraceAppDependencies } from "@langwatch/trace-server";

/** The other features' services the provider surface reads. */
export type ModelProviderPeers = Readonly<{
  /**
   * The span reader a cost rule's preview matches against, carried through the
   * application untouched: this process only knows its concrete type where it
   * composed a trace read stack.
   */
  spans?: TraceAppDependencies["traces"]["spans"];
}>;

import {
  apiModelProviderParts,
  type ApiModelProviderCompositionOptions,
} from "../../app/api-model-provider.composition.ts";

import type { ComposedModelProviderFeature } from "./model-provider.composition.types.ts";

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

/** Installs the three provider namespaces over this process's own graph. */
export async function installApiModelProvider(
  options: ApiModelProviderCompositionOptions & { peers?: ModelProviderPeers },
): Promise<ComposedModelProviderFeature> {
  const { credentials, ...technical } = apiModelProviderParts(options);

  const runtime = await createApp({ name: "langwatch-api" })
    // The cipher travels with the connection: a stored credential is a WIRE
    // FORMAT, written by one process and read by another, so the deployment's
    // one cipher is what the Postgres repositories are built over.
    .withPersistence("postgres", { prisma: options.prisma, credentials })
    .withInfrastructure({
      ...technical,
      // The vendor probe leaves this process, so it runs behind the SAME
      // address policy the gateway's own stored-credential probe runs behind.
      credentialProbe: HttpModelProviderCredentialProbeAdapter.create({
        egress: SsrfModelProviderEgressAdapter.create({ policy: options.egress }),
      }),
      codexAccounts: new CodexAccountService(),
      // Always passed, `undefined` included: the cost-rule preview's span
      // reader is the trace read stack's, and a process that composed none has
      // no reader to hand over rather than a different one.
      spans: options.peers?.spans,
    })
    .withProvided(ProjectApi, options.projects)
    .withProvided(OrganizationApi, options.organizations)
    .withProvided(AuthzApi, options.authorization)
    .withModule(modelProviderServer)
    .boot({ role: "api" });

  return { app: runtime.module(modelProviderServer).provided };
}
