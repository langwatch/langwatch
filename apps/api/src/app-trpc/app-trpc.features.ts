/**
 * Every tRPC surface this package owns, mounted on one process's root.
 *
 * The one list. A tRPC procedure declares its access decision as it is BUILT,
 * and the declaration sweep, the public-surface tripwire and the Langy
 * permission suites all read what mounting registered — so a family enumerated
 * a second time somewhere else could serve traffic while sitting outside every
 * one of those audits. Mount them by iterating this record, and read them the
 * same way: a surface is either in here and visible, or it does not exist.
 *
 * The process supplies its mount ONCE — the root a feature router must never
 * create a second of, the authenticated and public procedures it builds on,
 * and the concrete middlewares its policy chain is composed from — rather than
 * once per feature. That is the difference this file makes: a restated copy of
 * the same chain per feature could drift, and one cannot.
 */
import type { ApiTrpcFeatureMount } from "../api.application";
import type { ApiTrpcInfrastructure } from "./app-trpc.infrastructure";
import type { ComposedApiFeatures } from "./app-trpc.composed";

import { createAuthzTrpcRouter } from "../features/authz/authz-trpc.mount";
import { createDatasetRecordTrpcRouter } from "../features/dataset/dataset-trpc.mount";
import { createDashboardTrpcRouter } from "../features/dashboard/dashboard-trpc.mount";
import { createExportTrpcRouter } from "../features/export/export-trpc.mount";
import { createPersonalWorkspaceFeaturesTrpcRouter } from "../features/organization/organization-trpc.mount";
import { createPromptTagTrpcRouter } from "../features/prompt/prompt-trpc.mount";
import { createRoleBindingTrpcRouter } from "../features/role/role-trpc.mount";
import { composeGithubTrpcRouter } from "../features/github/github.composition";
import { createEnterpriseBillingTrpcRouters } from "../features/enterprise/enterprise-billing-trpc.mount";
import { createEnterpriseGovernanceTrpcRouters } from "../features/enterprise/enterprise-governance-trpc.mount";
import { composeGovernanceHomeTrpcRouter } from "../features/enterprise/governance-home.composition";
import { createPlanTrpcRouter } from "../features/entitlement/entitlement-trpc.mount";
import { type ModelProviderTrpcChecks } from "../features/model-provider/model-provider-trpc.mount";

/**
 * Builds every tRPC surface this package owns against one process's mount.
 *
 * The mount is this process's own {@link ApiTrpcFeatureMount}, not three type
 * parameters constrained to the intersection of every feature's context. The
 * root carries the context, so naming the root names the context once — and it
 * is what lets {@link AppTrpcFeatureRecord} be read off this function at all.
 *
 * The result is keyed by the namespace each surface answers on, so the caller
 * spreads it into its router record and adds nothing per feature. A surface
 * that is not in here is not mounted — which is the property the audits rely
 * on.
 */
export function createAppTrpcFeatures(options: {
  mount: ApiTrpcFeatureMount;
  /** What a feature composes ITSELF from, for the features composed here. */
  infrastructure: ApiTrpcInfrastructure;
  /**
   * The features the process composed BEFORE the mount existed, because their
   * doors are not only tRPC: the gateway's application is read by `ctx.app` and
   * by two REST families, so the process composes it once and hands the router
   * half here.
   */
  composed: ComposedApiFeatures;
}) {
  const { mount, composed, infrastructure } = options;
  const gateway = composed.gateway.router(mount);
  const langyRouters = composed.langy.routers(mount);
  const scenarioRouters = composed.scenario.routers(mount);
  const annotationRouters = composed.annotation.routers(mount);
  const spendRouters = composed.spend.routers(mount);
  const modelProviderRouters = composed.modelProvider.routers(mount);
  const workflowRouters = composed.workflow.routers(mount);
  const traceRouters = composed.trace.routers(mount);
  const shareRouters = composed.share.routers(mount);
  const analyticsRouters = composed.analytics.routers(mount);
  const datasetRouters = composed.dataset.routers(mount);
  const roleRouters = composed.role.routers(mount);
  const governance = createEnterpriseGovernanceTrpcRouters(mount);
  const enterprise = composed.enterprise.routers(mount);
  const automationRouters = composed.automation.routers(mount);
  const authRouters = composed.auth.routers(mount);
  const userRouters = composed.user.routers(mount);
  const membershipRouters = composed.organization.routers(mount);
  const billing = createEnterpriseBillingTrpcRouters({
    ...mount,
    saasBilling: infrastructure.saasBilling,
  });
  // `personalDashboard` is not a namespace of its own: `user:` below merges
  // it into `user.*`, which is the name the /me page and the CLI call it by.
  const { personalDashboard } = governance;

  return {
    costs: spendRouters.costs,
    httpProxy: composed.httpProxy.router(mount),
    limits: spendRouters.limits,
    llmModelCost: modelProviderRouters.llmModelCost,
    modelProvider: modelProviderRouters.modelProvider,
    // Both share surfaces take no ports: a link and a pin are rows this
    // deployment owns outright, reached through `ctx.app.share`.
    pinnedTrace: shareRouters.pinnedTrace,
    // What this organization is on. No ports either — the plan is resolved off
    // the application slice, because ONE answer to "which plan" is the whole
    // point of a plan provider.
    plan: createPlanTrpcRouter(mount),
    savedViews: composed.savedView.router(mount),
    share: shareRouters.share,
    // ADR-057's single anonymous trace read. It takes the process's PUBLIC
    // procedure and a `noPermission` declaration rather than a permission: the
    // share token in the input is the whole authorization, and the declaration
    // is what keeps the procedure reviewable rather than merely unchecked.
    sharedTrace: traceRouters.sharedTrace,
    spans: traceRouters.spans,
    topics: composed.topic.router(mount),
    traceEditOverlay: traceRouters.traceEditOverlay,
    // Carries `onTraceUpdate`. In the record rather than beside it: a
    // subscription mounted beside the record would be callable over
    // `/api/trpc` and un-watchable over `/api/sse`.
    traces: traceRouters.traces,
    // Carries `onDiscoverUpdate`, for the same reason.
    tracesV2: traceRouters.tracesV2,
    translate: modelProviderRouters.translate,
    automation: automationRouters.automation,
    codingAgents: composed.codingAgent.router(mount),
    // The unsubscribe pair arrives from a mail client with no session, so this
    // one takes the process's PUBLIC procedure as well. In the record rather
    // than beside it for the same reason every other public surface here is:
    // a namespace mounted outside the list would serve traffic from outside
    // every audit that reads it.
    emailSuppression: automationRouters.emailSuppression,
    license: enterprise.license,
    licenseEnforcement: enterprise.licenseEnforcement,
    organization: composed.organization.router(mount),
    project: composed.project.router(mount),
    scimToken: enterprise.scimToken,
    ssoConnections: enterprise.ssoConnections,
    // Carries `onConversationUpdate` and `onTurnStream`. In the record rather
    // than beside it: a subscription mounted beside the record would be
    // callable over `/api/trpc` and un-watchable over `/api/sse`.
    langy: langyRouters.langy,
    // Beside the conversation surface because both carry the same two gates
    // and the same application; the wire name stays `langyEgress`.
    langyEgress: langyRouters.langyEgress,
    ops: composed.ops.router(mount),
    // Carries `onSimulationUpdate`, for the same reason.
    scenarios: scenarioRouters.scenarios,
    setupSkills: scenarioRouters.setupSkills,
    // Takes no ports either — a suite, its folders and its runs are all read
    // through `ctx.app.suites`.
    suites: scenarioRouters.suites,
    dataRetention: composed.dataRetention.router(mount),
    monitors: composed.monitor.router(mount),
    storedObjects: composed.storedObject.router(mount),
    // The six core AI Gateway surfaces — one entry per namespace, straight off
    // `createGatewayTrpcRouters`. Composed over this process's own Prisma and
    // ClickHouse (see `composeApiGateway`); nothing here is a port any more.
    virtualKeys: gateway.virtualKeys,
    gatewayBudgets: gateway.gatewayBudgets,
    gatewayCacheRules: gateway.gatewayCacheRules,
    gatewayGuardrails: gateway.gatewayGuardrails,
    gatewaySpendEvents: gateway.gatewaySpendEvents,
    gatewayUsage: gateway.gatewayUsage,
    // `personalDashboard` is not mounted under its own name here — see `user:` below.
    activityMonitor: governance.activityMonitor,
    aiTools: governance.aiTools,
    anomalyRules: governance.anomalyRules,
    departments: governance.departments,
    ingestionKey: governance.ingestionKey,
    ingestionSources: governance.ingestionSources,
    ingestionTemplates: governance.ingestionTemplates,
    personalSessions: governance.personalSessions,
    personalVirtualKeys: governance.personalVirtualKeys,
    routingPolicy: governance.routingPolicy,
    sessionPolicy: governance.sessionPolicy,
    webhookEndpoints: governance.webhookEndpoints,
    // `governance` has two owners on one wire name: the five packaged
    // procedures above and this process's own `/` landing decision. Merged
    // HERE rather than inside either mount, so nothing outside this record can
    // add a third door onto the same name.
    governance: mount.root.mergeRouters(
      governance.governance,
      composeGovernanceHomeTrpcRouter({ mount, infrastructure }),
    ),
    // The two Enterprise billing surfaces — one entry per namespace, straight
    // off `createEnterpriseBillingTrpcRouters`. Both are mounted either way:
    // `saasBilling` false serves the empty router of the same served type
    // rather than dropping the namespace.
    currency: billing.currency,
    subscription: billing.subscription,
    // One wire namespace assembled from three packaged transports, exactly as
    // the client has always called it: the charted reads at `analytics.*`, the
    // workbench at `analytics.lwql`, and the saved charts at
    // `analytics.savedWorkbenchCharts`. Merged here rather than at the caller
    // so the whole namespace is one entry in this list, and so nothing outside
    // it can add a fourth door onto the same name.
    analytics: analyticsRouters.analytics,
    // A reviewer's comments, their scores and the queues they travel in,
    // composed by the feature itself over this process's connection, its
    // ClickHouse and the trace-side senders it registered once.
    annotation: annotationRouters.annotation,
    annotationScore: annotationRouters.annotationScore,
    apiKey: composed.apiKey.router(mount),
    // What the caller may do at one scope, as the product reports their own
    // standing back to them. It takes no ports: the answer comes from the same
    // AuthZ service every declared check on this root already runs on, so a
    // second one here would be a second answer to one question.
    authz: createAuthzTrpcRouter(mount),
    batchRecord: datasetRouters.batchRecord,
    // The support inbox, composed by the feature itself: the reports are a
    // global table with no tenant column, read by the back office under the
    // staff declaration the package writes.
    bugReports: composed.bugReport.router(mount),
    dashboards: createDashboardTrpcRouter(mount),
    // A project's datasets and the rows inside them: two wire names for one
    // application, because the rows are only reachable through the dataset
    // that holds them and a second service over them could disagree about
    // what one contains.
    dataset: datasetRouters.dataset,
    datasetRecord: createDatasetRecordTrpcRouter(mount),
    // The scoped privacy rules, composed by the feature itself: the cascade is
    // resolved through the project and organization directories, and both
    // writes anchor the target scope before they authorize it.
    dataPrivacy: composed.dataPrivacy.router(mount),
    // One trace re-scored, composed by the feature itself: the same
    // `evaluation_processing` producer the workbench's own runs report on.
    evaluations: composed.evaluation.router(mount),
    // The evaluators a project defines, beside the `evaluations.*` surface
    // that RUNS them. Two namespaces, two owners, one wire: an evaluator is a
    // definition and an evaluation is a result.
    evaluators: composed.evaluator.router(mount),
    experiments: composed.experiment.router(mount),
    // The two export-progress relays. This one surface owns its procedures
    // rather than delegating to a feature package — one relay over a channel
    // the PROCESS owns, distinguished only by the permission each demands —
    // so it takes no ports; see the mount's own docblock. It is in this list
    // because a subscription mounted beside the list would serve traffic from
    // outside every audit that reads it.
    export: createExportTrpcRouter(mount),
    frontDoor: authRouters.frontDoor,
    // Which rollouts this tenant is inside. No declared-permission policy and
    // no ports, and both are the same decision: every procedure authorizes the
    // exact tenant target it was asked for inside the package's own resolver,
    // which is not the scope id the input carries. The mount declares that
    // claim once for the whole surface.
    featureFlag: composed.featureFlag.router(mount),
    graphs: analyticsRouters.graphs,
    group: membershipRouters.group,
    // The GitHub App an organization connected, and the pull requests its
    // coding agents opened. Composed by the feature itself off the shared
    // infrastructure: one namespace, two answers nobody else owns, and no
    // graph shared with anything beside it.
    github: composeGithubTrpcRouter({ mount, infrastructure }),
    home: composed.home.router(mount),
    identity: userRouters.identity,
    // The setup checklist, composed by the feature itself: nine other
    // verticals' evidence plus the project's own two columns, and no one
    // feature package holds it.
    integrationsChecks: composed.integrationsChecks.router(mount),
    joinRequests: membershipRouters.joinRequests,
    // The sign-up ceremony, beside the `organization.createAndAssign` it is
    // built on: same package, same questionnaire schema, same opt-out reason.
    onboarding: membershipRouters.onboarding,
    // Who else is looking at this project, and where their cursor is. It takes
    // no ports — every answer is read off the request context's own
    // application slice — and it is in this list because two of its four
    // procedures are subscriptions: a namespace mounted beside the record
    // would be callable over `/api/trpc` and un-watchable over `/api/sse`.
    presence: composed.presence.router(mount),
    // A procedure rather than a router: the client calls `publicEnv({})` at
    // the root, and giving it a namespace would rename it.
    publicEnv: authRouters.publicEnv,
    // Two namespaces for one feature. `optimization.*` is not a second
    // workflow surface bolted on: those procedures are the optimization
    // studio's, and the name is the one its pages have always called.
    optimization: workflowRouters.optimization,
    // What a PERSONAL workspace may switch on. Same package and same
    // organization directory as `organization.*`, and it takes no ports for
    // the same reason `presence` does not: every answer is read off the
    // request context's own application slice.
    personalWorkspaceFeatures: createPersonalWorkspaceFeaturesTrpcRouter(mount),
    // A project's prompt library and, beside it, the organization's tag
    // catalogue those prompts are labelled from. One package, two wire names,
    // because the catalogue is the ORGANIZATION's and the library is the
    // project's — and only one of them takes a port.
    prompts: composed.prompt.router(mount),
    promptTags: createPromptTagTrpcRouter(mount),
    // Custom role definitions, and the bindings that hand them out. Two wire
    // names for one application, because who holds a role and what that role
    // grants are the same question asked from two ends.
    role: roleRouters.role,
    roleBinding: createRoleBindingTrpcRouter(mount),
    team: roleRouters.team,
    // The signed-in person's own account. The process merges the Enterprise
    // /me dashboard reads into the same namespace, so `user.*` answers from
    // two owners on one wire name.
    user: mount.root.mergeRouters(userRouters.user, personalDashboard),
    workflow: workflowRouters.workflow,
  };
}

/**
 * The record {@link createAppTrpcFeatures} returns, at THIS process's mount.
 *
 * Inferred from the function rather than restated, so a namespace added to the
 * return literal above is a namespace a client can call without a second edit.
 * This reads cleanly only because the mount is CONCRETE: the function takes
 * `ApiTrpcFeatureMount` rather than three type parameters, so the root every
 * router type carries is this process's own.
 */
export type AppTrpcFeatureRecord = ReturnType<typeof createAppTrpcFeatures>;
