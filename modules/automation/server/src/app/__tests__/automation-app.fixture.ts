import { automationServerConfigSchema } from "@langwatch/automation-contract";
import { PrismaClient, type Trigger as PrismaTrigger } from "@langwatch/prisma-client/generated";
import { ResourceScope } from "@langwatch/runtime-composition";
import { nowInstant, type Instant } from "@langwatch/time";
import { vi } from "vitest";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { AnalyticsApi } from "@langwatch/analytics-contract";
import type { EntitlementApi as EntitlementApiContract } from "@langwatch/entitlement-contract";
import { AutomationApp, type AutomationInfrastructure } from "../automation.app.ts";
import type { AutomationClockPort } from "../../ports/automation-clock.port.ts";
import type {
  AutomationGraphNotifierPort,
  AutomationLoggerPort,
} from "../../ports/automation-graph.port.ts";
import type { SchedulerWakePort } from "../../ports/scheduler-wake.port.ts";
import type { ScheduledJobStorePort } from "../../ports/scheduled-jobs.port.ts";
import type { UnsubscribeTokenVerifierPort } from "../../ports/unsubscribe-token.port.ts";
import type { AutomationRunawayPort } from "../../ports/automation-runaway.port.ts";
import type { AutomationTestFirePort } from "../../ports/automation-test-fire.port.ts";

export function createCanonicalAutomationApp(): {
  app: AutomationApp;
  triggerCreate: ReturnType<typeof vi.fn>;
  resources: ResourceScope;
} {
  const database = new PrismaClient({ accelerateUrl: "prisma://localhost/test" });
  const triggerCreate = vi.spyOn(database.trigger, "create").mockResolvedValue({
    id: "trigger_new",
    projectId: "project_1",
    name: "test",
    action: "SEND_SLACK_MESSAGE",
    triggerKind: "AUTOMATION",
    actionParams: {},
    filters: {},
    filterQuery: null,
    lastRunAt: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    active: true,
    pausedReason: null,
    pausedAt: null,
    message: null,
    deleted: false,
    alertType: null,
    slackTemplateType: null,
    slackTemplate: null,
    emailSubjectTemplate: null,
    emailBodyTemplate: null,
    notificationCadence: "immediate",
    traceDebounceMs: 0,
    customGraphId: null,
  } satisfies PrismaTrigger);
  const verifier: UnsubscribeTokenVerifierPort = {
    tryVerify: vi.fn(() => null),
  };
  const jobs: ScheduledJobStorePort = {
    upsertForTarget: vi.fn(async () => undefined),
    deactivateForTarget: vi.fn(async () => undefined),
    findAllForProject: vi.fn(async () => []),
  };
  const clock: AutomationClockPort = {
    now: vi.fn<() => Instant>(() => nowInstant()),
  };
  const wake: SchedulerWakePort = { publish: vi.fn() };
  const notifier: AutomationGraphNotifierPort = {
    dispatch: vi.fn<AutomationGraphNotifierPort["dispatch"]>(async () => ({
      channel: "none",
      didSend: false,
      missingVariables: [],
      renderErrors: [],
    })),
  };
  const logger: AutomationLoggerPort = {
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
  const runaway: AutomationRunawayPort = {
    countProjectTraces24h: vi.fn(async () => 0),
    notificationRecipients: vi.fn(async () => []),
    sendLimitEmail: vi.fn(async () => undefined),
    resolveNextStep: vi.fn(async () => undefined),
    tryClaimOnce: vi.fn(async () => null),
    releaseClaim: vi.fn(async () => undefined),
    projectName: vi.fn(async () => "Test project"),
    automationUrl: vi.fn(async () => "https://app.test/automations"),
    onCeilingBreach: vi.fn(),
    onAutoPaused: vi.fn(),
    onContainmentFailed: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  };
  const testFire: AutomationTestFirePort = {
    sendEmail: vi.fn(async () => undefined),
    sendSlack: vi.fn(async () => undefined),
    sendSlackBot: vi.fn(async () => undefined),
    sendWebhook: vi.fn(async () => ({ status: 200 })),
  };
  const projects: ProjectApi = {
    isPresenceEnabled: vi.fn(),
    tryGetById: vi.fn(),
    getOrganizationId: vi.fn(),
    tryGetSummaryById: vi.fn(async () => ({ name: "Test project", slug: "test-project" })),
    getWithTeam: vi.fn(),
    tryGetWithTeam: vi.fn(),
    create: vi.fn(),
    updateSettings: vi.fn(),
    archive: vi.fn(),
    regenerateLegacyProjectKey: vi.fn(),
    requestTopicClustering: vi.fn(),
    listByOrganization: vi.fn(),
    listByTeam: vi.fn(),
    touchCodingAgentPullRequestSeen: vi.fn(),
  };
  const analytics: AnalyticsApi = {
    getTimeseries: vi.fn(),
    getFeedbacks: vi.fn(),
    getTopUsedDocuments: vi.fn(),
    upsertEvaluationAnalytics: vi.fn(),
    upsertEvaluationAnalyticsBatch: vi.fn(),
    findEvaluationAnalytics: vi.fn(),
    appendEvaluationAnalyticsRollup: vi.fn(),
    appendEvaluationAnalyticsRollupBatch: vi.fn(),
    filterOptions: vi.fn(),
    isLangWatchQLAvailable: vi.fn(() => false),
    describeLangWatchQLSchema: vi.fn(),
    validateLangWatchQL: vi.fn(),
    executeLangWatchQL: vi.fn(),
  };
  const monitors: MonitorApi = {
    list: vi.fn(),
    getEnabledOnMessageMonitors: vi.fn(),
    listEnabledGuardrailMonitors: vi.fn(),
    getById: vi.fn(),
    findById: vi.fn(),
    getAllByIds: vi.fn(),
    toggle: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    deleteForExperiment: vi.fn(),
    upsertForExperiment: vi.fn(),
    isNameAvailable: vi.fn(),
    assertCheckRunnable: vi.fn(),
    copy: vi.fn(),
    replicate: vi.fn(),
    performanceForProject: vi.fn(),
  };
  const featureFlags: FeatureFlagApi = {
    isEnabled: vi.fn(),
    resolveFrontendFlags: vi.fn(),
    resolvePublicAnonymousFlags: vi.fn(),
    resolveExperimentCatalogue: vi.fn(),
    setUserExperimentEnrolment: vi.fn(),
    setExperimentTenantPolicy: vi.fn(),
    listOperatorCatalogue: vi.fn(),
    setEnabled: vi.fn(),
    setRules: vi.fn(),
    clearStoredFlag: vi.fn(),
  };
  const infrastructure: AutomationInfrastructure = {
    database,
    verifier,
    jobs,
    clock,
    wake,
    notifier,
    logger,
    runaway,
    testFire,
    slackTokens: { tryDecrypt: vi.fn() },
    dispatchErrors: { isTerminal: vi.fn(), createTerminal: vi.fn() },
    heartbeat: { tryResolveClickHouseClient: vi.fn() },
    redis: null,
    providers: {
      actionParamsSchemaFor: vi.fn(() => ({ safeParse: (data: unknown) => ({ success: true, data }) })),
      persistActionParamsFor: vi.fn(async (_action, args) => args.incoming),
      redactActionParamsFor: vi.fn((_action, params) => params),
      findSlackBotToken: vi.fn(() => null),
      decryptWebhookHeaders: vi.fn(() => ({})),
      decryptWebhookSigningSecrets: vi.fn(() => []),
    },
    slackChannels: { list: vi.fn(async () => ({ channels: [], error: null, gaps: [] })) },
    traceFilters: { assertCompiles: vi.fn() },
    limits: { count: vi.fn(async () => ({ allowed: true, resetAt: 0 })) },
    audit: { record: vi.fn(async () => undefined) },
  };
  const resources = new ResourceScope();
  resources.own("automation-test-database", () => database.$disconnect());
  return {
    app: AutomationApp.create({
      dependencies: {
        analytics,
        monitors,
        featureFlags,
        projects,
        entitlement: {
          getActivePlan: vi.fn<EntitlementApiContract["getActivePlan"]>(),
        },
      },
      infrastructure,
      config: automationServerConfigSchema.parse({}),
      resources,
    }),
    triggerCreate,
    resources,
  };
}
