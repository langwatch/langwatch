/**
 * The API process's packaged tRPC record, composed.
 *
 * `createAppTrpcFeatures` builds all twenty-two namespaces from one mount, the
 * shared infrastructure and the features this process composed. This
 * composition is what supplies them, and the mount arrives from the
 * application, because only the application holds the root those routers must
 * be built on.
 *
 * The record is ALL OR NOTHING and that is deliberate. A deployment cannot
 * serve `frontDoor` and not `publicEnv`, or `analytics` and not the workbench
 * inside it — the client calls one surface. So a process missing what the
 * record needs composes none of it and says which half is missing, rather than
 * mounting a partial record whose gaps a person discovers by clicking into
 * them.
 */
import { LiteMemberRestrictedError, type AuthzService } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";
import { ApiTrpcFeaturesPort, type ApiTrpcFeatureMount } from "../api.application";
import type { ApiTrpcInfrastructure } from "../app-trpc/app-trpc.infrastructure";
import type { ComposedApiFeatures } from "../app-trpc/app-trpc.composed";
import {
  ApiTrpcCollaboratorsAbsence,
  type ApiTrpcCollaborators,
} from "../app-trpc/app-trpc.collaborators";
import type { ApiTrpcFeatureApplication } from "../app-trpc/app-trpc.context";
import { createAppTrpcFeatures, type AppTrpcFeatureRecord } from "../app-trpc/app-trpc.features";

/**
 * Everything the record is composed from: the shared infrastructure a feature
 * composes ITSELF out of, the features composed before the mount existed, and
 * the one application every packaged surface reads off `ctx.app`.
 *
 * Two of them are nullable, and each says something different when it is
 * missing. No infrastructure means this process opened no database or no
 * permission service; no collaborators means it composed no application for
 * the record to read.
 */
export type ApiTrpcFeaturesCompositionOptions = Readonly<{
  infrastructure: ApiTrpcInfrastructure | undefined;
  /** The features the process composed before it had a mount; see the type. */
  composed: ComposedApiFeatures;
  collaborators: ApiTrpcCollaborators | undefined;
  report?: ApiTrpcCollaboratorsAbsence;
}>;

/**
 * The caller still holds a membership in this organization, but an admin
 * disabled it to stay within the licensed seat count, so it grants nothing.
 *
 * Raised HERE rather than imported because `TrpcAuthorizationDenialPort` asks
 * the PROCESS for it: the shape of the denial is the policy spine's, but the
 * copy and the code a client renders its own words from are the deployment's.
 * Deliberately not folded into the generic denial — reported as "you do not
 * have permission" it reads as a role problem the person could fix by asking
 * for a role, and reported as "no membership" it tells someone who IS a member
 * that they are not. An admin returning a seat is what actually resolves it.
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
   * Composes the record only when this process has BOTH halves of it.
   *
   * The INFRASTRUCTURE is not negotiable. Its connection is what forty of the
   * ports read rows on, and a record mounted over a missing one is twenty-two
   * namespaces that all answer the same 500; its permission service is what
   * every authorized surface on this root resolves through, and a host driving
   * this composition directly — a test, a second deployment shape — must not
   * be able to mount those surfaces over a service that does not exist. The
   * collaborator set is not negotiable for the reason its own docblock gives.
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
   * The two refusals the declared check answers with.
   *
   * Supplied rather than imported because the port says so: they carry product
   * copy and a code the client renders its own words from. `membership_disabled`
   * is raised as a handled error directly — a subclass here would be a second
   * class for one code, and the code is what the presentation registry is
   * keyed by.
   */
  readonly denials = {
    membershipDisabled: () => new MembershipDisabledError(),
    liteMemberRestricted: (resource: string) => new LiteMemberRestrictedError(resource),
  };

  /**
   * No translation. A handled error already states its own status, and this
   * process raises no untyped application class the chain would have to
   * recognise — anything else stays itself and degrades to an unknown error
   * with a trace id, which is ADR-045's intent rather than a gap.
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
 * The `ctx.app` slices the record reads, each contributed by the feature that
 * composed it.
 *
 * The whole application, and it is a name rather than a shape: every feature
 * on this process composes its own slice or its own named refusal, so the
 * record is assembled from thirty-odd features rather than from a handful of
 * groups that each carried somebody else's.
 */
export type ApiTrpcFeatureApplicationSlices = ApiTrpcFeatureApplication;
