/**
 * The four Enterprise `ctx.app` slices the fifteen governance and gateway-governance
 * surfaces read, or a refusal per capability.
 */
import { HandledError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";

import type { ApiTrpcFeatureApplication } from "../../app-trpc/app-trpc.context.ts";
import type { ApiEnterpriseApplication } from "./enterprise.composition.ts";

/** A capability this deployment did not compose, refused by name. */
class ApiCapabilityUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `This deployment has no ${capability}.`, {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiCapabilityUnavailableError";
  }
}

export type EnterpriseGovernanceApplication = Pick<
  ApiTrpcFeatureApplication,
  "governance" | "governanceApp" | "sessionPolicy" | "webhooks"
>;

const logger: Pick<Logger, "info"> = createLogger("langwatch:api:enterprise-governance");

/** The four slices, MEMBER BY MEMBER, each one either composed or refusing under its own name. */
export function composeEnterpriseGovernanceApplication(
  enterprise: ApiEnterpriseApplication | undefined,
): EnterpriseGovernanceApplication {
  const composed = {
    governance: enterprise?.governance,
    governanceApp: enterprise?.governanceApp,
    sessionPolicy: enterprise?.sessionPolicy,
    webhooks: enterprise?.webhooks,
  };

  for (const [member, absence] of ABSENCES) {
    if (composed[member]) continue;
    logger.info({ member }, absence);
  }

  return {
    governance:
      composed.governance ??
      refuse(
        "Enterprise governance capability, so it can neither read nor command an organization's governance",
      ),
    governanceApp:
      composed.governanceApp ??
      refuse(
        "Enterprise governance application, so it can neither mint a personal virtual key nor read a routing policy",
      ),
    sessionPolicy:
      composed.sessionPolicy ??
      refuse(
        "Enterprise session-policy store, so it cannot read or set an organization's session rules",
      ),
    webhooks:
      composed.webhooks ??
      refuse(
        "Enterprise webhook application, so it can neither list nor register a delivery endpoint",
      ),
  } as EnterpriseGovernanceApplication;
}

/** One boot line per absent member, naming the surfaces that go with it. */
const ABSENCES: ReadonlyArray<[keyof EnterpriseGovernanceApplication, string]> = [
  [
    "governance",
    "API composed no Enterprise governance capability: the governance console, the ingestion, department, AI-tool, activity and anomaly surfaces all mount and refuse by name",
  ],
  [
    "governanceApp",
    "API composed no Enterprise governance application: the personal virtual keys and the routing policies mount and refuse by name",
  ],
  [
    "sessionPolicy",
    "API composed no Enterprise session-policy store: reading and setting an organization's session rules refuse by name",
  ],
  [
    "webhooks",
    "API composed no Enterprise webhook application: listing and registering a delivery endpoint refuse by name",
  ],
];

/**
 * One absent member, refusing at whatever depth it is reached. A slice is read as
 * `application.endpoints.list(...)` as well as `application.list(...)`, and a one-level
 * stand-in answers the deeper reach with "not a function" — the named refusal replaced by
 * an unknown 500.
 */
function refuse(capability: string): never {
  const refusal: unknown = new Proxy(function refused() {} as never, {
    get: (_target, property) =>
      property === "then" ? undefined : (refusal as Record<string, unknown>),
    apply: () => {
      throw new ApiCapabilityUnavailableError(capability);
    },
    has: () => true,
  });
  return refusal as never;
}
