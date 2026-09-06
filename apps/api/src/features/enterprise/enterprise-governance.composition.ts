/**
 * The four Enterprise `ctx.app` slices the fifteen governance and gateway-governance
 * surfaces read, or a refusal per capability.
 */
import { HandledError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";

import type { ApiTrpcFeatureApplication } from "../../app-trpc/app-trpc.context.ts";
import type { ApiEnterpriseApplicationPort } from "./enterprise.composition.ts";

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

/** The four slices, or four refusals under the same names. */
export function composeEnterpriseGovernanceApplication(
  enterprise: ApiEnterpriseApplicationPort | undefined,
): EnterpriseGovernanceApplication {
  const governance = enterprise?.governance;
  if (governance) return governance;

  logger.info(
    {},
    "API composed no Enterprise governance application: the governance console, the ingestion, department, AI-tool, activity, anomaly and session surfaces, the personal virtual keys, the routing policies and the webhook endpoints all mount and refuse by name",
  );

  // Refuses at whatever depth it is reached. A slice is read as
  // `application.endpoints.list(...)` as well as `application.list(...)`, and a
  // one-level stand-in answers the deeper reach with "not a function" — the
  // named refusal replaced by an unknown 500.
  const refuse = (capability: string) => {
    const refusal: unknown = new Proxy(function refused() {} as never, {
      get: (_target, property) =>
        property === "then" ? undefined : (refusal as Record<string, unknown>),
      apply: () => {
        throw new ApiCapabilityUnavailableError(capability);
      },
      has: () => true,
    });
    return refusal as never;
  };

  return {
    governance: refuse(
      "Enterprise governance capability, so it can neither read nor command an organization's governance",
    ),
    governanceApp: refuse(
      "Enterprise governance application, so it can neither mint a personal virtual key nor read a routing policy",
    ),
    sessionPolicy: refuse(
      "Enterprise session-policy store, so it cannot read or set an organization's session rules",
    ),
    webhooks: refuse(
      "Enterprise webhook application, so it can neither list nor register a delivery endpoint",
    ),
  } as EnterpriseGovernanceApplication;
}
