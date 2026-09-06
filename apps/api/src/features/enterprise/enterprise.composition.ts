/**
 * The four Enterprise tenant namespaces, composed as their own feature. license.* /
 * licenseEnforcement.*   what this instance is licensed for scimToken.*
 * the directory-sync credentials ssoConnections.*                   the back office's
 */
import type { LimitCheckResult, LimitType } from "@langwatch/enterprise-licensing-contract";
import { LicensingApp, type LicensingCaller } from "@langwatch/enterprise-licensing-server";
import {
  ENTERPRISE_FEATURE_ERRORS,
  assertEnterprisePlanType,
} from "@langwatch/enterprise-plan-gate";
import { HandledError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";

import type { ApiAuditPort } from "../../api-request.policy";

import type { ApiTrpcFeatureApplication } from "../../app-trpc/app-trpc.context";
import {
  createEnterpriseTrpcRouters,
  type EnterpriseTrpcMountPorts,
} from "./enterprise-trpc.mount";

/**
 * Whether one seat allowance still admits another member, over the process's OWN plan
 * provider and membership counts.
 *
 * Separate from {@link ApiEnterpriseApplicationPort} because it is not Enterprise-only: an
 * unlicensed deployment has seat allowances too, and `/settings/members` asks about them on
 * every open. A deployment with no Enterprise application still answers this.
 */
export abstract class ApiSeatAllowancePort {
  abstract checkLimit(
    input: Readonly<{ organizationId: string; limitType: LimitType; user: LicensingCaller }>,
  ): Promise<LimitCheckResult>;
}

/**
 * The Enterprise application the nineteen Enterprise namespaces read.
 */
export abstract class ApiEnterpriseApplicationPort {
  /** The `ctx.app` slices the four tenant surfaces read. */
  abstract readonly application: Pick<
    ApiTrpcFeatureApplication,
    "licensing" | "scimApp" | "usageLimits"
  >;
  /**
   * The `ctx.app` slices the fifteen governance and gateway-governance surfaces read.
   */
  abstract readonly governance: Pick<
    ApiTrpcFeatureApplication,
    "governance" | "governanceApp" | "sessionPolicy" | "webhooks"
  >;
  /** The back office's single sign-on connection ledger. */
  abstract backoffice(): ReturnType<EnterpriseTrpcMountPorts["ssoConnections"]["backoffice"]>;
}

import type { ComposedEnterpriseFeature } from "./enterprise.composition.types";

/** Composes the four Enterprise tenant surfaces over this deployment's graph. */
export function composeEnterpriseFeature(options: {
  /** The audit trail a back-office command is written to. */
  audit: ApiAuditPort | undefined;
  /** The Enterprise application, where the deployment composed one. */
  enterprise?: ApiEnterpriseApplicationPort | undefined;
  /** The seat allowances this deployment answers without an Enterprise application. */
  seats?: ApiSeatAllowancePort | undefined;
}): ComposedEnterpriseFeature {
  const logger = createLogger("langwatch:api:enterprise");
  const application = enterpriseApplication(options.enterprise, options.seats, logger);
  const ports = enterprisePorts(options, logger);

  return {
    application,
    scim: application.scimApp,
    routers: (mount) => createEnterpriseTrpcRouters({ ...mount, ports }),
  };
}

/**
 * The Enterprise surfaces on a process that composed nothing to answer them.
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
 */
function enterpriseApplication(
  enterprise: ApiEnterpriseApplicationPort | undefined,
  seats: ApiSeatAllowancePort | undefined,
  logger: Logger,
): Pick<ApiTrpcFeatureApplication, "licensing" | "scimApp" | "usageLimits"> {
  if (enterprise) return enterprise.application;

  logger.info(
    { seatAllowances: Boolean(seats) },
    "API composed no Enterprise application: the licence, SCIM-token and single sign-on surfaces mount and refuse by name",
  );

  return {
    licensing: (seats
      ? unlicensedLicensing(seats, logger)
      : refusingApplicationSlice(
          "Enterprise licence store, so it cannot read or write an instance licence",
        )) as ApiTrpcFeatureApplication["licensing"],
    scimApp: refusingApplicationSlice(
      "Enterprise SCIM application, so it can neither list nor mint a token",
    ),
    usageLimits: unreportableUsageLimits(),
  } as Pick<ApiTrpcFeatureApplication, "licensing" | "scimApp" | "usageLimits">;
}

/**
 * The usage-limit notifier a deployment with no Enterprise application has.
 *
 * A REJECTED promise rather than a synchronous throw, and the difference is a door.
 * `licenseEnforcement.reportLimitBlocked` fires the notification and swallows its failure
 * (`void notify(...).catch(...)`); a synchronous throw escapes that catch and answers the
 * caller a 500 for a notification it never needed the answer to.
 */
function unreportableUsageLimits(): ApiTrpcFeatureApplication["usageLimits"] {
  return {
    notifyResourceLimitReached: () =>
      Promise.reject(
        new ApiEnterpriseUnavailableError(
          "Enterprise usage-limit store, so it cannot report a limit",
        ),
      ),
  };
}

/**
 * The licensing application an UNLICENSED deployment answers from.
 *
 * The seat allowances are real — the same plan provider and membership counts every other
 * allowance in this process reads — and everything that needs a licence STORE refuses by name.
 * `/settings/members` asks `checkLimit` on every open, and refusing it left the page blank on a
 * deployment that has seat allowances whether or not it is licensed.
 */
function unlicensedLicensing(seats: ApiSeatAllowancePort, logger: Logger): LicensingApp {
  const refuse = (capability: string): never => {
    throw new ApiEnterpriseUnavailableError(capability);
  };

  return LicensingApp.create({
    licenses: () =>
      refuse("Enterprise licence store, so it cannot read or write an instance licence"),
    cryptography: () => refuse("Enterprise licence signing key, so it cannot mint a licence"),
    configuredAuthProvider: () =>
      refuse("Enterprise single sign-on gate, so it cannot say why federation is off"),
    platformSsoAllowed: () =>
      Promise.reject(
        new ApiEnterpriseUnavailableError(
          "Enterprise licence store, so it cannot say whether single sign-on is licensed",
        ),
      ),
    authProviderIsMounted: () => false,
    reportSigningFailure: () => {},
    checkLimit: (input) => seats.checkLimit(input),
    reportError: (error) => {
      logger.error({ error }, "a licence-enforcement side effect failed");
    },
  });
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
