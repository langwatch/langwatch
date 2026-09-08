/**
 * The three Enterprise tenant namespaces, composed as their own feature.
 * license.* / licenseEnforcement.*   what this instance is licensed for
 * scimToken.*                        the directory-sync credentials
 */
import type { LimitCheckResult, LimitType } from "@langwatch/enterprise-licensing-contract";
import { LicensingApp, type LicensingCaller } from "@langwatch/enterprise-licensing-server";
import {
  ENTERPRISE_FEATURE_ERRORS,
  assertEnterprisePlanType,
} from "@langwatch/enterprise-plan-gate";
import { HandledError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";
import type { SsoConnectionLedgerPort } from "@langwatch/enterprise-api";

import type { ApiTrpcFeatureApplication } from "../../app-trpc/app-trpc.context.ts";
import {
  createEnterpriseTrpcRouters,
  type EnterpriseTrpcMountPorts,
} from "./enterprise-trpc.mount.ts";

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
 * The Enterprise application the nineteen Enterprise namespaces read, MEMBER BY MEMBER.
 *
 * Every member is separately optional, and that is the whole point of the shape. The
 * members do not share a graph — the session-policy store is one Postgres repository, the
 * webhook platform is the endpoint registry and its process store, the licence surfaces
 * want a licence store nothing here implements — so a port that carried them as two
 * objects made the deployment answer one question ("did you compose Enterprise?") for
 * eight independent ones, and a process that could serve six of them served none.
 *
 * An absent member is not a lesser member: the consumer reads it by name and refuses by
 * name when it is missing, so a customer is told which capability this deployment does not
 * have rather than that Enterprise is off.
 */
export abstract class ApiEnterpriseApplicationPort {
  /** Reading and writing this instance's licence. */
  abstract readonly licensing?: ApiTrpcFeatureApplication["licensing"] | undefined;
  /** The directory-sync application a SCIM token is listed and minted through. */
  abstract readonly scimApp?: ApiTrpcFeatureApplication["scimApp"] | undefined;
  /** Where a resource-limit notification is reported. */
  abstract readonly usageLimits?: ApiTrpcFeatureApplication["usageLimits"] | undefined;
  /** The governance capability the console's ten surfaces read. */
  abstract readonly governance?: ApiTrpcFeatureApplication["governance"] | undefined;
  /** The personal virtual keys and routing policies beside the capability. */
  abstract readonly governanceApp?: ApiTrpcFeatureApplication["governanceApp"] | undefined;
  /** The rules an organization bounds its members' sessions by. */
  abstract readonly sessionPolicy?: ApiTrpcFeatureApplication["sessionPolicy"] | undefined;
  /** Where a spend event is delivered, as the endpoint surface registers and lists them. */
  abstract readonly webhooks?: ApiTrpcFeatureApplication["webhooks"] | undefined;
  /** The back office's single sign-on connection ledger. */
  abstract readonly backoffice?: (() => SsoConnectionLedgerPort) | undefined;
}

import type { ComposedEnterpriseFeature } from "./enterprise.composition.types.ts";

/** Composes the three Enterprise tenant surfaces over this deployment's graph. */
export function composeEnterpriseFeature(options: {
  /** The Enterprise application, where the deployment composed one. */
  enterprise?: ApiEnterpriseApplicationPort | undefined;
  /** The seat allowances this deployment answers without an Enterprise application. */
  seats?: ApiSeatAllowancePort | undefined;
}): ComposedEnterpriseFeature {
  const logger = createLogger("langwatch:api:enterprise");
  const application = enterpriseApplication(options.enterprise, options.seats, logger);
  const ports = composeEnterpriseMountPorts();

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
        } as EnterpriseTrpcMountPorts,
      }),
  };
}

/**
 * The one Enterprise mount port: the plan gate a SCIM token is minted behind.
 *
 * Exported because the gate is the part worth pinning — the refusal a
 * deployment on a lesser plan reads is this one, and it is the SCIM
 * application's own plan provider rather than the process-wide one.
 */
export function composeEnterpriseMountPorts(): EnterpriseTrpcMountPorts {
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
  } as EnterpriseTrpcMountPorts;
}

/**
 * The three Enterprise `ctx.app` slices, or a refusal per capability.
 */
function enterpriseApplication(
  enterprise: ApiEnterpriseApplicationPort | undefined,
  seats: ApiSeatAllowancePort | undefined,
  logger: Logger,
): Pick<ApiTrpcFeatureApplication, "licensing" | "scimApp" | "usageLimits"> {
  const licensing = enterprise?.licensing;
  const scimApp = enterprise?.scimApp;
  const usageLimits = enterprise?.usageLimits;

  // One line per absent member, at boot. A deployment reads which capability it
  // does not have rather than inferring three from one sentence about Enterprise.
  if (!licensing) {
    logger.info(
      { member: "licensing", seatAllowances: Boolean(seats) },
      "API composed no Enterprise licence store: reading and writing this instance's licence refuses by name, and the seat allowances answer from this process's own plan provider",
    );
  }
  if (!scimApp) {
    logger.info(
      { member: "scimApp" },
      "API composed no Enterprise SCIM application: listing and minting a directory-sync token refuse by name",
    );
  }
  if (!usageLimits) {
    logger.info(
      { member: "usageLimits" },
      "API composed no Enterprise usage-limit store: a resource-limit notification is not reported",
    );
  }

  return {
    licensing: (licensing ??
      (seats
        ? unlicensedLicensing(seats, logger)
        : refusingApplicationSlice(
            "Enterprise licence store, so it cannot read or write an instance licence",
          ))) as ApiTrpcFeatureApplication["licensing"],
    scimApp:
      scimApp ??
      refusingApplicationSlice(
        "Enterprise SCIM application, so it can neither list nor mint a token",
      ),
    usageLimits: usageLimits ?? unreportableUsageLimits(),
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
