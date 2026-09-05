/**
 * The API process's packaged tRPC record, composed. `createAppTrpcFeatures` builds all
 * twenty-two namespaces from one mount, the shared infrastructure and the features this
 * process composed.
 */
import { LiteMemberRestrictedError, type AuthzService } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";
import { ApiTrpcFeaturesPort, type ApiTrpcFeatureMount } from "../api.application";
import type { ApiTrpcInfrastructure } from "../platform/infrastructure/api-trpc.infrastructure";
import type { ComposedApiFeatures } from "../app-trpc/app-trpc.composed";
import {
  ApiTrpcCollaboratorsAbsence,
  type ApiTrpcCollaborators,
} from "../app-trpc/app-trpc.collaborators";
import type { ApiTrpcFeatureApplication } from "../app-trpc/app-trpc.context";
import { createAppTrpcFeatures, type AppTrpcFeatureRecord } from "../app-trpc/app-trpc.features";

/**
 * Everything the record is composed from: the shared infrastructure a feature composes
 * ITSELF out of, the features composed before the mount existed, and the one application
 * every packaged surface reads off `ctx.app`.
 */
export type ApiTrpcFeaturesCompositionOptions = Readonly<{
  infrastructure: ApiTrpcInfrastructure | undefined;
  /** The features the process composed before it had a mount; see the type. */
  composed: ComposedApiFeatures;
  collaborators: ApiTrpcCollaborators | undefined;
  report?: ApiTrpcCollaboratorsAbsence;
}>;

/**
 * The caller still holds a membership in this organization, but an admin disabled it to
 * stay within the licensed seat count, so it grants nothing.
 */
class MembershipDisabledError extends HandledError {
  declare readonly code: "membership_disabled";

  constructor() {
    super("membership_disabled", "Your access to this organization has been disabled", {
      httpStatus: 403,
      fault: "customer",
    });
    this.name = "MembershipDisabledError";
  }
}

export class ApiTrpcFeaturesComposition extends ApiTrpcFeaturesPort {
  /**
   * Composes the record only when this process has BOTH halves of it. The INFRASTRUCTURE
   * is not negotiable.
   */
  static tryCompose(
    options: ApiTrpcFeaturesCompositionOptions,
  ): ApiTrpcFeaturesComposition | undefined {
    const { infrastructure, collaborators } = options;
    if (!infrastructure) {
      options.report?.absent("no-database");
      return undefined;
    }
    if (!collaborators) {
      options.report?.absent("no-collaborators");
      return undefined;
    }
    return new ApiTrpcFeaturesComposition(infrastructure, options.composed, collaborators);
  }

  readonly application: ApiTrpcFeatureApplication;

  /** The permission service the policy chain resolves every decision through. */
  readonly authorization: AuthzService;

  private constructor(
    private readonly infrastructure: ApiTrpcInfrastructure,
    private readonly composed: ComposedApiFeatures,
    collaborators: ApiTrpcCollaborators,
  ) {
    super();
    this.application = collaborators.application;
    this.authorization = infrastructure.authz;
  }

  /**
   * The two refusals the declared check answers with. Supplied rather than imported
   * because the port says so: they carry product copy and a code the client renders its
   * own words from.
   */
  readonly denials = {
    membershipDisabled: () => new MembershipDisabledError(),
    liteMemberRestricted: (resource: string) => new LiteMemberRestrictedError(resource),
  };

  /**
   * No translation.
   */
  readonly causes = { translate: () => undefined };

  readonly errorReporting = {
    capture: (failure: unknown) => {
      this.logger.error({ error: failure }, "tRPC call failed");
    },
    asError: (failure: unknown): Error =>
      failure instanceof Error ? failure : new Error(String(failure)),
  };

  build(mount: ApiTrpcFeatureMount): AppTrpcFeatureRecord {
    return createAppTrpcFeatures({
      mount,
      composed: this.composed,
      infrastructure: this.infrastructure,
    });
  }

  private readonly logger: Pick<Logger, "error"> = createLogger("langwatch:api:trpc");
}

/** Writes the record's absence to the process log, with its consequence. */
export class LoggedApiTrpcFeaturesAbsence extends ApiTrpcCollaboratorsAbsence {
  static create(logger: Pick<Logger, "warn">): LoggedApiTrpcFeaturesAbsence {
    return new LoggedApiTrpcFeaturesAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  absent(reason: "no-collaborators" | "no-database"): void {
    const consequence =
      reason === "no-database"
        ? "no database or no AuthZ service was composed"
        : "the deployment composed no application for the record to read";
    this.logger.warn(
      { reason },
      `API process serves no packaged tRPC namespaces: ${consequence}. The agent and secret routers are unaffected.`,
    );
  }
}

/**
 * The `ctx.app` slices the record reads, each contributed by the feature that composed
 * it.
 */
export type ApiTrpcFeatureApplicationSlices = ApiTrpcFeatureApplication;
