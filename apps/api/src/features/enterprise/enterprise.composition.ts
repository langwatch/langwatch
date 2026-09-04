/**
 * The four Enterprise tenant namespaces, composed as their own feature.
 *
 *   license.* / licenseEnforcement.*   what this instance is licensed for
 *   scimToken.*                        the directory-sync credentials
 *   ssoConnections.*                   the back office's federation ledger
 *
 * One feature because they are one deployment decision: a deployment either
 * composed the Enterprise application or it did not, and a licence without a
 * SCIM application is not a smaller product but a half-wired one.
 *
 * The namespaces MOUNT either way. A client asking "what is my licence" must
 * be told this deployment cannot answer, rather than have the call disappear,
 * so every absence here is a refusal BY NAME rather than an empty list.
 */
import {
  ENTERPRISE_FEATURE_ERRORS,
  assertEnterprisePlanType,
} from "@langwatch/enterprise-plan-gate";
import { HandledError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";

import type { ApiAuditPort } from "../../api-request.policy";
import type { ApiTrpcFeatureMount } from "../../api.application";
import type { ApiTrpcFeatureApplication } from "../../app-trpc/app-trpc.context";
import {
  createEnterpriseTrpcRouters,
  type EnterpriseTrpcMountPorts,
} from "./enterprise-trpc.mount";

/**
 * The Enterprise application the nineteen Enterprise namespaces read.
 *
 * One port rather than nineteen, because a deployment either composed the
 * Enterprise application or it did not: a licence without a SCIM application
 * is not a smaller product, it is a half-wired one, and a governance console
 * without the capability behind it is a page of empty lists that reads as
 * "nothing configured".
 *
 * Two features fill from it. This one reads the licensing, SCIM and
 * usage-limit slices and the single sign-on ledger; the gateway group reads
 * `governance`. The port is one because the deployment decision is one.
 */
export abstract class ApiEnterpriseApplicationPort {
  /** The `ctx.app` slices the four tenant surfaces read. */
  abstract readonly application: Pick<
    ApiTrpcFeatureApplication,
    "licensing" | "scimApp" | "usageLimits"
  >;
  /**
   * The `ctx.app` slices the fifteen governance and gateway-governance
   * surfaces read.
   *
   * A separate member rather than four more entries on `application` above,
   * because the two halves are filled by two different composition folds and a
   * single object would make each of them able to overwrite the other's.
   */
  abstract readonly governance: Pick<
    ApiTrpcFeatureApplication,
    "governance" | "governanceApp" | "sessionPolicy" | "webhooks"
  >;
  /** The back office's single sign-on connection ledger. */
  abstract backoffice(): ReturnType<EnterpriseTrpcMountPorts["ssoConnections"]["backoffice"]>;
}

/** The four namespaces, the three `ctx.app` slices, and the SCIM REST door. */
export type ComposedEnterpriseFeature = Readonly<{
  routers(mount: ApiTrpcFeatureMount): ReturnType<typeof createEnterpriseTrpcRouters>;
  /** For `ctx.app.licensing`, `ctx.app.scimApp` and `ctx.app.usageLimits`. */
  application: Pick<ApiTrpcFeatureApplication, "licensing" | "scimApp" | "usageLimits">;
  /**
   * The SCIM application the packaged REST family serves, where this process
   * composed the feature at all. Published beside the application because that
   * door is mounted rather than refused: a family over an application nobody
   * composed would answer 503 to a directory that expects a token list.
   */
  scim?: ApiTrpcFeatureApplication["scimApp"] | undefined;
}>;

/** Composes the four Enterprise tenant surfaces over this deployment's graph. */
export function composeEnterpriseFeature(options: {
  /** The audit trail a back-office command is written to. */
  audit: ApiAuditPort | undefined;
  /** The Enterprise application, where the deployment composed one. */
  enterprise?: ApiEnterpriseApplicationPort | undefined;
}): ComposedEnterpriseFeature {
  const logger = createLogger("langwatch:api:enterprise");
  const application = enterpriseApplication(options.enterprise, logger);
  const ports = enterprisePorts(options, logger);

  return {
    application,
    scim: application.scimApp,
    routers: (mount) => createEnterpriseTrpcRouters({ ...mount, ports }),
  };
}

/**
 * The Enterprise surfaces on a process that composed nothing to answer them.
 *
 * All four namespaces still mount and every call refuses by name: an operator
 * reading an empty connection list would conclude this deployment has no
 * federated tenants, which is a different statement from "this process cannot
 * see them".
 */
export function refusingEnterpriseFeature(): ComposedEnterpriseFeature {
  const refuse = (capability: string) => refusingApplicationSlice(capability);

  return {
    application: {
      licensing: refuse("Enterprise licence store, so it cannot read or write an instance licence"),
      scimApp: refuse("Enterprise SCIM application, so it can neither list nor mint a token"),
      usageLimits: refuse("Enterprise usage-limit store, so it cannot report a limit"),
    } as Pick<ApiTrpcFeatureApplication, "licensing" | "scimApp" | "usageLimits">,
    routers: (mount) =>
      createEnterpriseTrpcRouters({
        ...mount,
        ports: {
          scimToken: {
            requireEnterprisePlan: () =>
              Promise.reject(
                new ApiEnterpriseUnavailableError(
                  "Enterprise plan gate, so it cannot mint a token",
                ),
              ),
          },
          ssoConnections: {
            backoffice: () => unavailableSsoBackoffice(),
            recordAudit: () => Promise.resolve(),
          },
        } as EnterpriseTrpcMountPorts,
      }),
  };
}

/**
 * The two Enterprise ports, and the refusal that stands in for one of them.
 *
 * The SCIM plan gate is answered for real — it is a read against the plan
 * provider the call itself carries — while the back office's connection ledger
 * comes from the Enterprise application, because a single sign-on connection
 * is an Enterprise resource with an Enterprise lifecycle. With none composed,
 * every command on it refuses by name.
 */
function enterprisePorts(
  options: Readonly<{
    audit: ApiAuditPort | undefined;
    enterprise?: ApiEnterpriseApplicationPort | undefined;
  }>,
  logger: Logger,
): EnterpriseTrpcMountPorts {
  return {
    scimToken: {
      requireEnterprisePlan: async ({ planProvider, organizationId }) => {
        const plan = await planProvider.getActivePlan({ organizationId });
        assertEnterprisePlanType({
          planType: plan.type,
          errorMessage: ENTERPRISE_FEATURE_ERRORS.SCIM,
        });
      },
    },
    ssoConnections: {
      backoffice: () => {
        const enterprise = options.enterprise;
        if (!enterprise) {
          return unavailableSsoBackoffice();
        }
        return enterprise.backoffice();
      },
      recordAudit: async (entry) => {
        await options.audit?.record({
          actorId: entry.userId,
          path: entry.action,
          input: {
            ...entry.args,
            targetKind: entry.targetKind,
            ...(entry.targetId === undefined ? {} : { targetId: entry.targetId }),
          },
          error: null,
        });
        logger.debug({ action: entry.action }, "recorded a single sign-on back-office command");
      },
    },
  } as EnterpriseTrpcMountPorts;
}

/**
 * The single sign-on ledger, absent.
 *
 * Every one of its eleven commands refuses by name rather than one of them
 * answering emptily: an operator reading an empty connection list would
 * conclude this deployment has no federated tenants, which is a different
 * statement from "this process cannot see them".
 */
function unavailableSsoBackoffice(): ReturnType<
  EnterpriseTrpcMountPorts["ssoConnections"]["backoffice"]
> {
  const refuse = (): never => {
    throw new ApiEnterpriseUnavailableError(
      "Enterprise single sign-on ledger, so it can neither read nor command a connection",
    );
  };
  return new Proxy({} as never, { get: () => refuse, has: () => true });
}

/**
 * The three Enterprise `ctx.app` slices, or a refusal per capability.
 *
 * A refusing application rather than an absent one, because the four
 * namespaces MOUNT either way: a client asking what its licence allows has to
 * be told this deployment cannot answer, and a namespace that simply is not
 * there tells it nothing at all.
 */
function enterpriseApplication(
  enterprise: ApiEnterpriseApplicationPort | undefined,
  logger: Logger,
): Pick<ApiTrpcFeatureApplication, "licensing" | "scimApp" | "usageLimits"> {
  if (enterprise) return enterprise.application;

  logger.info(
    {},
    "API composed no Enterprise application: the licence, licence-enforcement, SCIM-token and single sign-on surfaces mount and refuse by name",
  );

  return {
    licensing: refusingApplicationSlice(
      "Enterprise licence store, so it cannot read or write an instance licence",
    ),
    scimApp: refusingApplicationSlice(
      "Enterprise SCIM application, so it can neither list nor mint a token",
    ),
    usageLimits: refusingApplicationSlice(
      "Enterprise usage-limit store, so it cannot report a limit",
    ),
  } as Pick<ApiTrpcFeatureApplication, "licensing" | "scimApp" | "usageLimits">;
}

/** One `ctx.app` slice this deployment did not compose, refusing by name. */
function refusingApplicationSlice<T>(capability: string): T {
  return new Proxy({} as never, {
    get: () => () => {
      throw new ApiEnterpriseUnavailableError(capability);
    },
    has: () => true,
  }) as T;
}

/** A capability this deployment did not compose, refused by name. */
export class ApiEnterpriseUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `This deployment has no ${capability}.`, {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiEnterpriseUnavailableError";
  }
}
