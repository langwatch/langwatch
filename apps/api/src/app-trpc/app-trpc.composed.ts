/**
 * The features this process composed BEFORE it had a tRPC mount. Most features compose
 * themselves inside the record's own literal, from the shared infrastructure and the
 * mount, and never appear here.
 */
import type { ComposedGatewayFeature } from "../features/gateway/gateway.composition";
import type { ComposedLangyFeature } from "../features/langy/langy.composition";
import type { ComposedBugReportFeature } from "../features/bug-report/bug-report.composition";
import type { ComposedDataPrivacyFeature } from "../features/data-privacy/data-privacy.composition";
import type { ComposedAnnotationFeature } from "../features/annotation/annotation.composition";
import type { ComposedSavedViewFeature } from "../features/dashboard/saved-view.composition";
import type { ComposedSpendFeature } from "../features/entitlement/spend.composition";
import type { ComposedHttpProxyFeature } from "../features/agent/http-proxy.composition";
import type { ComposedModelProviderFeature } from "../features/model-provider/model-provider.composition";
import type { ComposedShareFeature } from "../features/share/share.composition";
import type { ComposedTopicFeature } from "../features/topic/topic.composition";
import type { ComposedTraceFeature } from "../features/trace/trace.composition";
import type { ComposedIntegrationsChecksFeature } from "../features/project/integrations-checks.composition";
import type { ComposedOpsFeature } from "../features/ops/ops.composition";
import type { ComposedAnalyticsFeature } from "../features/analytics/analytics.composition";
import type { ComposedDatasetFeature } from "../features/dataset/dataset.composition";
import type { ComposedEvaluatorFeature } from "../features/evaluator/evaluator.composition";
import type { ComposedPromptFeature } from "../features/prompt/prompt.composition";
import type { ComposedHomeFeature } from "../features/project/home.composition";
import type { ComposedRoleFeature } from "../features/role/role.composition";
import type { ComposedFeatureFlagFeature } from "../features/feature-flag/feature-flag.composition";
import type { ComposedDataRetentionFeature } from "../features/data-retention/data-retention.composition";
import type { ComposedMonitorFeature } from "../features/monitor/monitor.composition";
import type { ComposedScenarioFeature } from "../features/scenario/scenario.composition";
import type { ComposedStoredObjectFeature } from "../features/stored-object/stored-object.composition";
import type { ComposedWorkflowFeature } from "../features/workflow/workflow.composition";
import type { ComposedExperimentFeature } from "../features/experiment/experiment.composition";
import type { ComposedEvaluationFeature } from "../features/evaluation/evaluation.composition";
import type { ComposedOrganizationFeature } from "../features/organization/organization.composition";
import type { ComposedProjectFeature } from "../features/project/project.composition";
import type { ComposedCodingAgentFeature } from "../features/coding-agent/coding-agent.composition";
import type { ComposedAutomationFeature } from "../features/automation/automation.composition";
import type { ComposedEnterpriseFeature } from "../features/enterprise/enterprise.composition";
import type { ComposedAuthFeature } from "../features/auth/auth.composition";
import type { ComposedUserFeature } from "../features/user/user.composition";
import type { ComposedPresenceFeature } from "../features/presence/presence.composition";
import type { ComposedApiKeyFeature } from "../features/api-key/api-key.composition";

export type ComposedApiFeatures = Readonly<{
  /** Six namespaces, one `ctx.app` slice and two REST families over one application. */
  gateway: ComposedGatewayFeature;
  /**
   * Two namespaces and the `ctx.app.langy` slice the packaged Langy REST family
   * reads. Here rather than in the record's literal for that last reason.
   */
  langy: ComposedLangyFeature;
  /**
   * One namespace behind its own operator chain, plus the `ctx.app.ops` slice
   * every other surface's staff check reads. Here rather than in the record's
   * literal because that slice is read by surfaces this feature does not own.
   */
  ops: ComposedOpsFeature;
  /**
   * Three namespaces, the `ctx.app.scenarios` and `ctx.app.suites` slices, and
   * the four services the two packaged scenario REST families take directly.
   */
  scenario: ComposedScenarioFeature;
  /**
   * Two namespaces, the `ctx.app.analytics` and `ctx.app.dashboard` slices, and
   * the governed-SQL runner the public LangWatchQL REST family takes whole.
   */
  analytics: ComposedAnalyticsFeature;
  /**
   * One namespace and the ONE rollout store every other gate on this process
   * reads. Composed before every feature that gates on a flag.
   */
  featureFlag: ComposedFeatureFlagFeature;
  /** Two namespaces and the `ctx.app.dataset` slice the dataset REST family reads. */
  dataset: ComposedDatasetFeature;
  /**
   * One namespace, the `ctx.app.evaluatorApp` slice, and the replication ports
   * the monitor feature takes as its peer.
   */
  evaluator: ComposedEvaluatorFeature;
  /** One namespace and the `ctx.app.prompts` slice two other doors read. */
  prompt: ComposedPromptFeature;
  /** One namespace: the strip of entities a person recently opened. */
  home: ComposedHomeFeature;
  /**
   * Two namespaces, the `ctx.app.roles` and `ctx.app.authzApp` slices, and the
   * role service the invitation half asks about assignable custom roles.
   */
  role: ComposedRoleFeature;
  /** One namespace, over the policy this process supplies the packaged rules. */
  dataRetention: ComposedDataRetentionFeature;
  /** One namespace and the `ctx.app.monitors` slice the monitor REST family reads. */
  monitor: ComposedMonitorFeature;
  /** One namespace: the support inbox the back office reads. */
  bugReport: ComposedBugReportFeature;
  /** One namespace: the privacy rules a project's scopes are redacted under. */
  dataPrivacy: ComposedDataPrivacyFeature;
  /** One namespace: the setup checklist the onboarding screens render. */
  integrationsChecks: ComposedIntegrationsChecksFeature;
  /**
   * Two namespaces and the `ctx.app.annotations` slice the annotation REST
   * family reads. Here rather than in the record's literal for that reason.
   */
  annotation: ComposedAnnotationFeature;
  /** One namespace: the stored filter sets the explorer offers. */
  savedView: ComposedSavedViewFeature;
  /** Two namespaces: an organization's spend, and the allowance it is taken against. */
  spend: ComposedSpendFeature;
  /** One namespace: the studio's outbound dispatch and the agent test's trace write. */
  httpProxy: ComposedHttpProxyFeature;
  /**
   * Three namespaces and the `ctx.app.modelProviders` slice every other surface
   * reads a provider through.
   */
  modelProvider: ComposedModelProviderFeature;
  /** Two namespaces and the `ctx.app.share` ledger every share door reads. */
  share: ComposedShareFeature;
  /** One namespace and the `ctx.app.topics` reader the grid labels rows from. */
  topic: ComposedTopicFeature;
  /**
   * Five namespaces, the `ctx.app.traces` application and the read stack the
   * public REST trace doors take directly.
   */
  trace: ComposedTraceFeature;
  /**
   * One namespace, the `ctx.app.storedObjectApp` slice two REST families read,
   * and the content-addressed byte store the scenario-event door writes through.
   */
  storedObject: ComposedStoredObjectFeature;
  /**
   * Two namespaces and the `ctx.app.workflows` application the packaged
   * workflow REST family reads. Here rather than in the record's literal for
   * that last reason.
   */
  workflow: ComposedWorkflowFeature;
  /**
   * One namespace, the `ctx.app.experiments` application, and the RUN LOOP the
   * three REST run doors dispatch through.
   */
  experiment: ComposedExperimentFeature;
  /**
   * One namespace, the `ctx.app.evaluations` slice, and the ONE
   * `evaluation_processing` producer every re-score and every workbench cell
   * reports on.
   */
  evaluation: ComposedEvaluationFeature;
  /** The one namespace a tenant's members, teams and invitations are administered through. */
  organization: ComposedOrganizationFeature;
  /**
   * One namespace and the `ctx.app.projects` application several other
   * namespaces read a project's own summary off.
   */
  project: ComposedProjectFeature;
  /**
   * One namespace, the `ctx.app.codingAgentApp` application, and the same
   * application again for the packaged coding-agent REST family.
   */
  codingAgent: ComposedCodingAgentFeature;
  /**
   * Two namespaces over one application: a project's triggers and the
   * addresses that asked their channels to stop.
   */
  automation: ComposedAutomationFeature;
  /**
   * The four Enterprise tenant namespaces and the three `ctx.app` slices
   * behind them, mounted whether or not this deployment composed the
   * Enterprise application.
   */
  enterprise: ComposedEnterpriseFeature;
  /**
   * The two signed-out doors, and the ONE auth application both answer from:
   * the sign-in mode it resolves is ADR-027's single source of truth for the
   * whole deployment.
   */
  auth: ComposedAuthFeature;
  /**
   * Two namespaces and the `ctx.app.users` slice, plus the operator allow-list
   * and the parsed `ctx.app.config` the retention gate and the sidebar read.
   */
  user: ComposedUserFeature;
  /**
   * One namespace, the `ctx.app.presence` and `ctx.app.broadcast` slices, and
   * the ONE tenant fan-out every subscription and both bulk exports ride.
   */
  presence: ComposedPresenceFeature;
  /** One namespace and the `ctx.app.apiKeys` slice every credential door reads. */
  apiKey: ComposedApiKeyFeature;
}>;
