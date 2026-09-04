/**
 * The four Enterprise `ctx.app` slices the fifteen governance and
 * gateway-governance surfaces read, or a refusal per capability.
 *
 * A refusing application rather than an absent one, because the fifteen
 * namespaces MOUNT either way: a console asking which ingestion sources an
 * organization has must be told this deployment cannot answer, and a namespace
 * that simply is not there tells it nothing at all.
 *
 * The application itself is a PORT rather than something composed here, and
 * that is a fence rather than a difficulty: `AppGovernanceRuntime.create`
 * requires a `GovernanceEventingPort` built from the ingestion-pull and
 * pulled-usage command registrations, and the event-sourcing runtime that owns
 * them has not moved out of the retired application. The only in-tree
 * alternative is that package's no-op eventing port, which would accept every
 * ingestion-pull command and queue none of them — a silent drop, which is the
 * one thing a named absence exists to prevent.
 */
import { HandledError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";

import type { ApiTrpcFeatureApplication } from "../../app-trpc/app-trpc.context";
import type { ApiEnterpriseApplicationPort } from "./enterprise.composition";

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

  const refuse = (capability: string) =>
    new Proxy({} as never, {
      get: () => () => {
        throw new ApiCapabilityUnavailableError(capability);
      },
      has: () => true,
    });

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
