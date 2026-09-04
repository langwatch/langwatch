/**
 * The API process's packaged tRPC record, composed.
 *
 * `createAppTrpcFeatures` builds all twenty-two namespaces from one mount and
 * one ports object. This composition is what supplies both: the ports come from
 * {@link createApiTrpcPorts} — this process's Prisma connection, its AuthZ
 * service and its audit sink, plus the collaborators it received — and the
 * mount arrives from the application, because only the application holds the
 * root those routers must be built on.
 *
 * The record is ALL OR NOTHING and that is deliberate. A deployment cannot
 * serve `frontDoor` and not `publicEnv`, or `analytics` and not the workbench
 * inside it — the client calls one surface. So a process missing what the
 * record needs composes none of it and says which half is missing, rather than
 * mounting a partial record whose gaps a person discovers by clicking into
 * them.
 */
import type { AnalyticsReadInput, AnalyticsTimeseriesInput } from "@langwatch/analytics-contract";
import { LiteMemberRestrictedError, type AuthzService } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";
import type { ZodTypeAny } from "zod";
import { ApiTrpcFeaturesPort, type ApiTrpcFeatureMount } from "../api.application";
import type { ApiTrpcInfrastructure } from "../app-trpc/app-trpc.infrastructure";
import {
  ApiTrpcCollaboratorsAbsence,
  type ApiTrpcCollaborators,
} from "../app-trpc/app-trpc.collaborators";
import type { ApiTrpcFeatureApplication } from "../app-trpc/app-trpc.context";
import { createAppTrpcFeatures, type AppTrpcFeatureRecord } from "../app-trpc/app-trpc.features";
import { createApiTrpcPorts } from "./api-trpc-ports.composition";
import type { ApiAgentGroupCollaborators } from "./api-trpc-collaborators.agent-group.composition";
import type { ApiAnalyticsCollaborators } from "./api-trpc-collaborators.analytics.composition";
import type { ApiExecutionCollaborators } from "./api-trpc-collaborators.execution.composition";
import type { ApiGatewayGroupCollaborators } from "./api-trpc-collaborators.gateway-group.composition";
import type { ApiIdentityCollaborators } from "./api-trpc-collaborators.identity.composition";
import type { ApiOrgGroupCollaborators } from "./api-trpc-collaborators.org-group.composition";
import type { ApiProductGroupCollaborators } from "./api-trpc-collaborators.product-group.composition";
import type { ApiProductInfraCollaborators } from "./api-trpc-collaborators.product-infra.composition";
import {
  type ApiProductCollaborators,
  type ApiTrpcCollaboratorGapReport,
} from "./api-trpc-collaborators.product.composition";
import type { ApiTraceGroupCollaborators } from "./api-trpc-collaborators.trace-group.composition";

/**
 * Everything the record is composed from: the shared infrastructure a feature
 * composes ITSELF out of, and the collaborators the features that have not
 * moved onto it yet are still reached through.
 *
 * Both are nullable, and each says something different when it is missing. No
 * infrastructure means this process opened no database or no permission
 * service; no collaborators means it composed none of what the record reaches.
 */
export type ApiTrpcFeaturesCompositionOptions<
  TBugReport,
  TBugReportPage,
  TCheckStatus,
  TFilterField extends string,
  TMappingsIn,
  TMappingsOut,
  TPrivacyRule,
  TPrivacySnapshot,
  TReadInput extends AnalyticsReadInput,
  TSignUpDataSchema extends ZodTypeAny,
  TTimeseriesInput extends AnalyticsTimeseriesInput,
  TWorkbenchState,
  TTimeseriesInputWire,
  TReadInputWire,
> = Readonly<{
  infrastructure: ApiTrpcInfrastructure | undefined;
  collaborators:
    | ApiTrpcCollaborators<
        TBugReport,
        TBugReportPage,
        TCheckStatus,
        TFilterField,
        TMappingsIn,
        TMappingsOut,
        TPrivacyRule,
        TPrivacySnapshot,
        TReadInput,
        TSignUpDataSchema,
        TTimeseriesInput,
        TWorkbenchState,
        TTimeseriesInputWire,
        TReadInputWire
      >
    | undefined;
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

export class ApiTrpcFeaturesComposition<
  TBugReport,
  TBugReportPage,
  TCheckStatus,
  TFilterField extends string,
  TMappingsIn,
  TMappingsOut,
  TPrivacyRule,
  TPrivacySnapshot,
  TReadInput extends AnalyticsReadInput,
  TSignUpDataSchema extends ZodTypeAny,
  TTimeseriesInput extends AnalyticsTimeseriesInput,
  TWorkbenchState,
  TTimeseriesInputWire,
  TReadInputWire,
> extends ApiTrpcFeaturesPort {
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
  static tryCompose<
    TBugReport,
    TBugReportPage,
    TCheckStatus,
    TFilterField extends string,
    TMappingsIn,
    TMappingsOut,
    TPrivacyRule,
    TPrivacySnapshot,
    TReadInput extends AnalyticsReadInput,
    TSignUpDataSchema extends ZodTypeAny,
    TTimeseriesInput extends AnalyticsTimeseriesInput,
    TWorkbenchState,
    TTimeseriesInputWire,
    TReadInputWire,
  >(
    options: ApiTrpcFeaturesCompositionOptions<
      TBugReport,
      TBugReportPage,
      TCheckStatus,
      TFilterField,
      TMappingsIn,
      TMappingsOut,
      TPrivacyRule,
      TPrivacySnapshot,
      TReadInput,
      TSignUpDataSchema,
      TTimeseriesInput,
      TWorkbenchState,
      TTimeseriesInputWire,
      TReadInputWire
    >,
  ):
    | ApiTrpcFeaturesComposition<
        TBugReport,
        TBugReportPage,
        TCheckStatus,
        TFilterField,
        TMappingsIn,
        TMappingsOut,
        TPrivacyRule,
        TPrivacySnapshot,
        TReadInput,
        TSignUpDataSchema,
        TTimeseriesInput,
        TWorkbenchState,
        TTimeseriesInputWire,
        TReadInputWire
      >
    | undefined {
    const { infrastructure, collaborators } = options;
    if (!infrastructure) {
      options.report?.absent("no-database");
      return undefined;
    }
    if (!collaborators) {
      options.report?.absent("no-collaborators");
      return undefined;
    }
    return new ApiTrpcFeaturesComposition(infrastructure, collaborators);
  }

  readonly application: ApiTrpcFeatureApplication;

  /** The permission service the policy chain resolves every decision through. */
  readonly authorization: AuthzService;

  private constructor(
    private readonly infrastructure: ApiTrpcInfrastructure,
    private readonly collaborators: ApiTrpcCollaborators<
      TBugReport,
      TBugReportPage,
      TCheckStatus,
      TFilterField,
      TMappingsIn,
      TMappingsOut,
      TPrivacyRule,
      TPrivacySnapshot,
      TReadInput,
      TSignUpDataSchema,
      TTimeseriesInput,
      TWorkbenchState,
      TTimeseriesInputWire,
      TReadInputWire
    >,
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
    const ports = createApiTrpcPorts({
      prisma: this.infrastructure.prisma,
      authz: this.infrastructure.authz,
      audit: this.infrastructure.audit,
      mount,
      collaborators: this.collaborators,
    });
    return createAppTrpcFeatures({ mount, infrastructure: this.infrastructure, ports });
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
        : "the deployment supplied none of the collaborators the record reaches — the analytics filter catalogue, the LangWatchQL workbench, the trace pipeline, the sign-in and sign-up ceremonies, the evaluator runtime, the model gateway and the Enterprise governance surfaces";
    this.logger.warn(
      { reason },
      `API process serves no packaged tRPC namespaces: ${consequence}. The agent and secret routers are unaffected.`,
    );
  }
}

/**
 * The ten halves {@link composeApiTrpcCollaborators} reads into one flat
 * {@link ApiTrpcCollaborators} record. Each is `undefined` exactly when the
 * process composed nothing for it — see that half's own composing function
 * for why it can be missing.
 */
/**
 * The same ten once every one of them is present.
 *
 * `Required<>` is not this: it strips the `?` a member does not have and leaves
 * the `| undefined` a member does, so the whole record read below stayed
 * nullable and every `half.field` became "possibly undefined".
 */
type ComposedApiTrpcCollaboratorHalves = {
  readonly [K in keyof ApiTrpcCollaboratorHalves]-?: NonNullable<ApiTrpcCollaboratorHalves[K]>;
};

export type ApiTrpcCollaboratorHalves = Readonly<{
  product: ApiProductCollaborators | undefined;
  analytics: ApiAnalyticsCollaborators | undefined;
  identity: ApiIdentityCollaborators | undefined;
  execution: ApiExecutionCollaborators | undefined;
  productGroup: ApiProductGroupCollaborators | undefined;
  traceGroup: ApiTraceGroupCollaborators | undefined;
  agentGroup: ApiAgentGroupCollaborators | undefined;
  orgGroup: ApiOrgGroupCollaborators | undefined;
  productInfra: ApiProductInfraCollaborators | undefined;
  gatewayGroup: ApiGatewayGroupCollaborators | undefined;
}>;

/**
 * Reads all ten collaborator halves into ONE flat {@link ApiTrpcCollaborators}
 * record, or refuses by name.
 *
 * All-or-nothing, replacing the ten `withApi*Collaborators` folds and the
 * runtime `sealApiTrpcCollaborators` check those folds needed: a process
 * missing any half composes none of the record, named, rather than mounting
 * the other nine over a gap. No cast to an erased type anywhere in this
 * function — every `half.field` access below is checked against the real,
 * concrete type each `compose*` function already returns, so a half's return
 * type drifting from what this literal expects is a compile error here
 * rather than a silent `unknown`. The return type is left to inference
 * rather than restated as an explicit `ApiTrpcCollaborators<...>` — the
 * interface takes more type parameters than any one caller instantiates by
 * hand, and inference already carries the concrete types through to
 * `ApiTrpcFeaturesComposition.tryCompose`, which is the one place they are
 * pinned.
 */
export function composeApiTrpcCollaborators(
  halves: ApiTrpcCollaboratorHalves,
  report?: ApiTrpcCollaboratorGapReport,
) {
  const missing = (Object.keys(halves) as (keyof ApiTrpcCollaboratorHalves)[]).filter(
    (name) => halves[name] === undefined,
  );
  if (missing.length > 0) {
    report?.incomplete(missing);
    return undefined;
  }
  const {
    product,
    analytics,
    identity,
    execution,
    productGroup,
    traceGroup,
    agentGroup,
    orgGroup,
    productInfra,
    gatewayGroup,
  } = halves as ComposedApiTrpcCollaboratorHalves;

  return {
    application: {
      annotations: product.annotations,
      analytics: analytics.analytics,
      dashboard: analytics.dashboard,
      ...identity.application,
      workflows: execution.workflows,
      experiments: execution.experiments,
      evaluations: execution.evaluations,
      authzApp: productGroup.authzApp,
      dataset: productGroup.datasetApp,
      evaluatorApp: productGroup.evaluatorApp,
      featureFlags: productGroup.featureFlagService,
      permissions: productGroup.permissions,
      // `projects` is the ORG group's: `...orgGroup.application` below carries
      // it and overwrote the product group's reader in this slot, silently.
      prompts: productGroup.promptApp,
      roles: productGroup.roleApp,
      traces: traceGroup.traces,
      share: traceGroup.share,
      dataRetention: traceGroup.dataRetention,
      topics: traceGroup.topics,
      modelProviders: traceGroup.modelProviders,
      planProvider: traceGroup.planProvider,
      scenarios: agentGroup.scenarios,
      suites: agentGroup.suites,
      langy: agentGroup.langy,
      // Overwrites the identity half's narrower `isAdmin` reader in this same
      // slot on purpose: the operator SURFACE reads the whole application,
      // and the SSO connection door (which gates on the staff list rather
      // than `ops:*`) is satisfied by it unchanged.
      ops: agentGroup.ops,
      ...orgGroup.application,
      monitors: productInfra.monitorApp,
      storedObjectApp: productInfra.storedObjectApp,
      ...gatewayGroup.application,
    },

    annotation: product.annotationPorts,
    bugReports: product.bugReportPorts,
    dataPrivacy: product.dataPrivacyPorts,
    integrationsChecks: product.integrationsChecksPorts,

    analytics: analytics.analyticsPorts,
    graphs: analytics.graphPorts,

    auth: identity.auth,
    group: identity.group,
    identity: identity.identity,
    joinRequests: identity.joinRequests,
    onboarding: identity.onboarding,
    user: identity.user,

    workflows: execution.workflowPorts,
    experiments: execution.experimentPorts,
    evaluations: execution.evaluationPorts,

    batchRecord: productGroup.batchRecordPorts,
    evaluators: productGroup.evaluatorPorts,
    role: productGroup.rolePorts,
    dataset: productGroup.datasetPorts,
    home: productGroup.homePorts,
    prompts: productGroup.promptPorts,
    team: productGroup.teamPorts,

    traces: traceGroup.ports.traces,
    tracesV2: traceGroup.ports.tracesV2,
    spans: traceGroup.ports.spans,
    traceEditOverlay: traceGroup.ports.traceEditOverlay,
    sharedTrace: traceGroup.ports.sharedTrace,
    savedViews: traceGroup.ports.savedViews,
    costs: traceGroup.ports.costs,
    llmModelCost: traceGroup.ports.llmModelCost,
    modelProvider: traceGroup.ports.modelProvider,
    modelProviderChecks: traceGroup.ports.modelProviderChecks,
    translate: traceGroup.ports.translate,
    httpProxy: traceGroup.ports.httpProxy,
    limits: traceGroup.ports.limits,

    scenarios: agentGroup.ports.scenarios,
    langy: agentGroup.ports.langy,
    langyGates: agentGroup.ports.langyGates,
    langyEgress: agentGroup.ports.langyEgress,
    ops: agentGroup.ports.ops,
    opsCheck: agentGroup.ports.opsCheck,

    organization: orgGroup.organization,
    organizationAuditLogCheck: orgGroup.organizationAuditLogCheck,
    project: orgGroup.project,
    projectChecks: orgGroup.projectChecks,
    codingAgents: orgGroup.codingAgents,
    automation: orgGroup.automation,
    emailSuppression: orgGroup.emailSuppression,
    enterprise: orgGroup.enterprise,

    dataRetention: productInfra.dataRetention,
    monitors: productInfra.monitors,

    gateway: gatewayGroup.gateway,
  };
}
