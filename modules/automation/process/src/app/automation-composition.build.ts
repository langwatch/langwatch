/**
 * Builds AutomationInfrastructure for both processes: trigger reads and writes, and the
 * graph-alert delivery a re-evaluation dispatches through (mail, Slack, webhook).
 */
import type { AnalyticsApi } from "@langwatch/analytics-contract";
import type { AnnotationApi } from "@langwatch/annotation-contract";
import type { AuditLogApi, RecordAuditLogCommand } from "@langwatch/audit-log-contract";
import {
  ApiAutomationUnavailableError,
  type AutomationAction,
  type AutomationPersistCapBreach,
  type DatasetActionParams,
  type GraphTriggerEvaluationReason,
  type GraphTriggerEvaluationResult,
  type GraphTriggerSweepCandidate,
  type SlackActionParams,
  type SlackChannelListing,
} from "@langwatch/automation-contract";
import {
  mapTraceToDatasetEntry,
  TRACE_EXPANSIONS,
  type DatasetApi,
  type DatasetRecordEntry,
} from "@langwatch/dataset-contract";
import {
  WebhookDispatchRateLimiter,
  WebhookEgressService,
  type WebhookDispatchRateLimitResult,
} from "@langwatch/egress";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { DispatchError } from "@langwatch/eventing";
import { PrismaScheduledJobStore, SchedulerService } from "@langwatch/eventing/server";
import { ReactEmailMailRenderer } from "@langwatch/mail";
import type { Logger } from "@langwatch/observability";
import type { Encryption, Mail, ProcessMembers } from "@langwatch/process-stores/members";
import type { ProjectApi } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import { fromDate, nowInstant, toDate, type Instant } from "@langwatch/time";
import { traceSchema, type TraceRecord } from "@langwatch/trace-contract";

import type { AutomationGraphNotifier } from "../channels/automation-graph-alert.channel.ts";
import { AutomationNotificationDelivery } from "../channels/automation-notification-delivery.channel.ts";
import type { AutomationRunawayNotice } from "../channels/automation-runaway-notice.channel.ts";
import { SchedulerWake } from "../channels/automation-scheduler-wake.channel.ts";
import { AutomationTestFire } from "../channels/automation-test-fire.channel.ts";
import { EgressWebhookDeliveryTransport } from "../channels/http/http.webhook-egress.channel.ts";
import { AutomationPersistActionWriter } from "../repositories/automation-persist-action.repository.ts";
import type { AutomationPersistCapRepository } from "../repositories/automation-persist-cap.repository.ts";
import type { AutomationRunaway } from "../repositories/automation-runaway.repository.ts";
import type {
  AutomationScheduledJobRepository,
  ScheduledJobRecord,
} from "../repositories/automation-scheduled-job.repository.ts";
import { AutomationSettlementBreach } from "../repositories/automation-settlement-ledger.repository.ts";
import type {
  AutomationSettlementEvaluationReader,
  AutomationSettlementTraceReader,
} from "../repositories/automation-settlement-read.repository.ts";
import type { AutomationRepositories } from "../repositories/automation.repositories.ts";
import {
  PrismaAutomationSettlementLedgerRepository,
  type AutomationSettlementLedgerDatabase,
} from "../repositories/prisma/prisma.automation-settlement-ledger.repository.ts";
import {
  PrismaGraphTriggerSentRepository,
  type GraphTriggerSentDatabase,
} from "../repositories/prisma/prisma.graph-trigger-sent.repository.ts";
import {
  PrismaTriggerRepository,
  type TriggerDatabase,
} from "../repositories/prisma/prisma.trigger.repository.ts";
import {
  PrismaWebhookDeliveryRepository,
  type WebhookDeliveryDatabase,
} from "../repositories/prisma/prisma.webhook-delivery.repository.ts";
import { RedisAutomationEmailCapRepository } from "../repositories/redis/redis.automation-email-cap.repository.ts";
import { RedisAutomationPersistCapRepository } from "../repositories/redis/redis.automation-persist-cap.repository.ts";
import { AutomationDatasetMapper } from "../services/automation-dataset-mapper.service.ts";
import { AutomationGraphDeliveryService } from "../services/automation-graph-delivery.service.ts";
import type {
  AutomationDispatchError,
  AutomationHeartbeat,
  AutomationLogger,
} from "../services/automation-graph-runtime.service.ts";
import { AutomationNotificationDeliveryService } from "../services/automation-notification-delivery.service.ts";
import { AutomationProviderRegistryService } from "../services/automation-provider-registry.service.ts";
import type { AutomationRunawaySignals } from "../services/automation-runaway-signals.service.ts";
import { AutomationScheduledIntent } from "../services/automation-scheduled-intent.service.ts";
import type { AutomationSettlementExecutor } from "../services/automation-settlement-executor.service.ts";
import type { AutomationSettlementLedgerService } from "../services/automation-settlement-ledger.service.ts";
import {
  AutomationSettlementMatchConfirmationService,
  type AutomationSettlementEvaluationFilters,
  type AutomationSettlementTraceFilters,
} from "../services/automation-settlement-match-confirmation.service.ts";
import type { AutomationSettlementObservability } from "../services/automation-settlement-observability.service.ts";
import {
  AutomationSlackSecretsService,
  type AutomationSecretCrypto,
  type AutomationSlackBotTokenDecryptor,
} from "../services/automation-slack-secrets.service.ts";
import { AutomationWebhookSecretsService } from "../services/automation-webhook-secrets.service.ts";
import { AutomationEmailCapService } from "../services/email-cap.service.ts";
import { GraphAlertDispatchService } from "../services/graph-alert-dispatch.service.ts";
import { GraphTriggerHeartbeatService } from "../services/graph-trigger-heartbeat.service.ts";
import { AutomationPersistActionService } from "../services/persist-action.service.ts";
import { AutomationPersistCapService } from "../services/persist-cap.service.ts";
import { RunawayContainmentService } from "../services/runaway-containment.service.ts";
import { AutomationSettlementDispatchService } from "../services/trigger-settlement-dispatch.service.ts";
import type {
  AutomationAuditSink,
  AutomationCallCounter,
  AutomationInfrastructure,
  AutomationProviderSecrets,
  AutomationSlackDirectory,
  AutomationTraceFilterCompiler,
  AutomationWebhookStoredParams,
} from "./automation.app.ts";
import type {
  AutomationClock,
  AutomationGraphActivity,
  AutomationProjectDirectory,
} from "./automation.members.ts";

/** What `buildAutomationInfrastructure` reads off process members. */
export type AutomationProcessMembers = Readonly<{
  prisma: ProcessMembers["prisma"];
  redis: RedisConnection;
  logger: Logger;
  encryption: Encryption;
  mail: Mail;
  publicBaseUrl: string | undefined;
  /** SaaS verifies a webhook receiver's certificate; self-hosted receivers often self-sign. */
  isSaas: boolean;
}>;

type AutomationInfrastructureInput = Readonly<{
  members: AutomationProcessMembers;
  auditLog: AuditLogApi;
  verifier: AutomationInfrastructure["verifier"];
  /** The key the verifier checks with, so every link this process mails verifies. */
  unsubscribeSigningSecret: string | undefined;
  repositories: Pick<AutomationRepositories, "triggers" | "suppressions" | "webhookDeliveries">;
  caps: Readonly<{ emailHourlyCap: number; tenantDailyCap: number }>;
}>;

/** What settlement sends through: the SAME delivery and ceilings graph alerts spend. */
export type AutomationComposedInfrastructure = AutomationInfrastructure &
  Readonly<{ delivery: AutomationNotificationDelivery; emailCaps: AutomationEmailCapService }>;

/** Builds the {@link AutomationInfrastructure} `AutomationApp.create` composes over. */
export function buildAutomationInfrastructure(
  input: AutomationInfrastructureInput,
): AutomationComposedInfrastructure {
  const { members } = input;
  const providers = AutomationProviderRegistryService.create(members.encryption);
  const clock = new ApiAutomationClock();
  const delivery = buildNotificationDelivery(input);
  const emailCaps = AutomationEmailCapService.create({
    store: RedisAutomationEmailCapRepository.create({ connection: members.redis }),
  });

  return {
    delivery,
    emailCaps,
    verifier: input.verifier,
    // The report calendar, on the SAME `ScheduledJob` store the worker's loop
    // claims a due row through — Eventing's own, not a second narrowing of it,
    // so the row this process writes on save is the row that process reads.
    jobs: new InstantScheduledJobRepository(new PrismaScheduledJobStore(members.prisma)),
    clock,
    wake: new ApiSchedulerWake(members.redis),
    notifier: buildGraphAlertNotifier({ ...input, providers, clock, delivery, emailCaps }),
    logger: new ApiAutomationLogger(members.logger),
    slackTokens: new ApiAutomationSlackTokens(providers),
    dispatchErrors: new ApiAutomationDispatchErrors(),
    heartbeat: new UnmeasuredApiAutomationHeartbeat(),
    runaway: new UncontainedApiAutomationRunaway(members.logger),
    testFire: new UndeliverableApiTestFire(),
    persistCaps: RedisAutomationPersistCapRepository.create({ connection: members.redis }),
    providers: new AutomationProviderSecretsAdapter(providers),
    slackChannels: new UnavailableAutomationSlackDirectory(),
    traceFilters: new UnwiredAutomationTraceFilterCompiler(),
    limits: new RedisAutomationCallCounter(members.redis),
    audit: new AuditLogAutomationAuditSink(input.auditLog),
    publicBaseUrl: members.publicBaseUrl,
  };
}

/**
 * {@link AutomationScheduledJobRepository} over Eventing's `Date`-typed
 * store: converts to/from {@link Instant} here, once, instead of at every
 * call site.
 */
class InstantScheduledJobRepository implements AutomationScheduledJobRepository {
  constructor(private readonly store: PrismaScheduledJobStore) {}

  upsertForTarget(input: {
    projectId: string;
    targetType: string;
    targetId: string;
    cron: string;
    timezone: string;
    nextRunAt: Instant;
  }): Promise<void> {
    return this.store.upsertForTarget({ ...input, nextRunAt: toDate(input.nextRunAt) });
  }

  deactivateForTarget(input: {
    projectId: string;
    targetType: string;
    targetId: string;
  }): Promise<void> {
    return this.store.deactivateForTarget(input);
  }

  async findAllForProject(input: {
    projectId: string;
    targetType: string;
  }): Promise<ScheduledJobRecord[]> {
    const rows = await this.store.findAllForProject(input);
    return rows.map((row) => ({
      targetId: row.targetId,
      nextRunAt: fromDate(row.nextRunAt),
      lastSlot: row.lastSlot === null ? null : fromDate(row.lastSlot),
      active: row.active,
    }));
  }
}

/** The process's own wall clock, as the feature reads time. */
class ApiAutomationClock implements AutomationClock {
  now() {
    return nowInstant();
  }
}

/**
 * The cross-process wake a freshly written schedule publishes, best-effort:
 * the worker's poll backstop is the correctness layer, so a dropped publish
 * only costs time until the next sweep, never a missed fire.
 */
class ApiSchedulerWake extends SchedulerWake {
  constructor(private readonly redis: RedisConnection) {
    super();
  }

  publish(): void {
    SchedulerService.publishWake(this.redis as never);
  }
}

/**
 * Main's graph-alert delivery (worker-automation-graph.composition.ts): no public
 * origin means no alert, since every alert links back to it.
 */
export function buildGraphAlertNotifier(
  input: Pick<AutomationInfrastructureInput, "repositories" | "caps"> &
    Readonly<{
      members: Pick<AutomationProcessMembers, "publicBaseUrl">;
      providers: AutomationProviderRegistryService;
      clock: AutomationClock;
      delivery: AutomationNotificationDelivery;
      emailCaps: AutomationEmailCapService;
    }>,
): AutomationGraphNotifier {
  if (!input.members.publicBaseUrl) return new UndeliveredGraphAlerts();

  return GraphAlertDispatchService.create({
    persistence: AutomationGraphDeliveryService.create(input.repositories),
    emailCaps: input.emailCaps,
    delivery: input.delivery,
    webhooks: input.providers.webhooks,
    clock: input.clock,
    emailHourlyCap: input.caps.emailHourlyCap,
    tenantDailyCap: input.caps.tenantDailyCap,
  });
}

/**
 * Mail, Slack and webhook delivery over the mail member and the fenced webhook sender
 * (main's worker-webhook-egress.composition.ts). No public origin, no delivery.
 */
function buildNotificationDelivery(
  input: Pick<AutomationInfrastructureInput, "members" | "unsubscribeSigningSecret">,
): AutomationNotificationDelivery {
  const { members } = input;
  if (!members.publicBaseUrl) return new UnavailableNotificationDelivery();

  const egress = WebhookEgressService.create({
    rateLimiter: new RedisWebhookDispatchRateLimiter(members.redis),
    tls: { rejectUnauthorized: members.isSaas },
  });
  return AutomationNotificationDeliveryService.create({
    mailer: members.mail,
    renderer: ReactEmailMailRenderer.create(),
    baseHost: members.publicBaseUrl,
    ...(input.unsubscribeSigningSecret === undefined
      ? {}
      : { unsubscribeSigningSecret: input.unsubscribeSigningSecret }),
    webhookTransport: EgressWebhookDeliveryTransport.create(egress),
    logger: members.logger,
  });
}

/** Main's refusal for a process with no public origin: a digest would link back to nowhere. */
class UnavailableNotificationDelivery extends AutomationNotificationDelivery {
  sendLegacyEmail(): Promise<void> {
    return refuseDelivery();
  }

  sendEmail(): Promise<void> {
    return refuseDelivery();
  }

  sendSlackWebhook(): Promise<void> {
    return refuseDelivery();
  }

  sendLegacySlackWebhook(): Promise<void> {
    return refuseDelivery();
  }

  sendSlackBot(): Promise<void> {
    return refuseDelivery();
  }

  sendWebhook(): Promise<never> {
    return refuseDelivery();
  }
}

function refuseDelivery(): Promise<never> {
  return Promise.reject(
    new DispatchError({
      message:
        "This process composes no outbound automation delivery: it named no BASE_HOST, so a digest would carry links back to nowhere. Set BASE_HOST to send settled notifications from here.",
      retryable: false,
    }),
  );
}

/** A process with no public origin cannot link an alert back, so it refuses by name. */
class UndeliveredGraphAlerts implements AutomationGraphNotifier {
  dispatch(): Promise<never> {
    return Promise.reject(new ApiAutomationUnavailableError("deliver graph alerts"));
  }
}

/** The feature's log lines, on this process's own logger member. */
class ApiAutomationLogger implements AutomationLogger {
  constructor(private readonly logger: Logger) {}

  error(fields: Record<string, unknown>, message: string): void {
    this.logger.error(fields, message);
  }

  debug(fields: Record<string, unknown>, message: string): void {
    this.logger.debug(fields, message);
  }

  info(fields: Record<string, unknown>, message: string): void {
    this.logger.info(fields, message);
  }

  warn(fields: Record<string, unknown>, message: string): void {
    this.logger.warn(fields, message);
  }
}

/**
 * The stored Slack bot token, read through the SAME registry the authoring
 * redaction path uses — one cipher, so a token stored by one door is
 * readable by the other.
 */
class ApiAutomationSlackTokens implements AutomationSlackBotTokenDecryptor {
  constructor(private readonly providers: AutomationProviderRegistryService) {}

  findDecryptedToken(params: SlackActionParams): string | null {
    return this.providers.findDecryptedSlackBotToken(params);
  }
}

/**
 * Retryable versus terminal, for a process with no queue: every failure
 * reads as terminal, since one called retryable here would simply be lost.
 */
class ApiAutomationDispatchErrors implements AutomationDispatchError {
  isTerminal(): boolean {
    return true;
  }

  createTerminal(message: string): unknown {
    return new Error(message);
  }
}

/** The heartbeat's recency query has no endpoint here. */
class UnmeasuredApiAutomationHeartbeat implements AutomationHeartbeat {
  findClickHouseClient(): Promise<null> {
    return Promise.resolve(null);
  }
}

/**
 * Runaway containment, for a process that fires nothing: reads answer
 * emptily and writes refuse, since a ceiling enforced here would be one
 * nobody actually counts against.
 */
class UncontainedApiAutomationRunaway
  implements AutomationRunaway, AutomationRunawayNotice, AutomationRunawaySignals
{
  constructor(private readonly logger: Logger) {}

  countProjectTraces24h(): Promise<number> {
    return Promise.resolve(0);
  }

  notificationRecipients(): Promise<string[]> {
    return Promise.resolve([]);
  }

  sendLimitEmail(): Promise<void> {
    return Promise.reject(new ApiAutomationUnavailableError("send automation limit mail"));
  }

  findNextStep(): Promise<undefined> {
    return Promise.resolve(undefined);
  }

  claimOnce(): Promise<"already-claimed"> {
    return Promise.resolve("already-claimed");
  }

  releaseClaim(): Promise<void> {
    return Promise.resolve();
  }

  projectName(projectId: string): Promise<string> {
    return Promise.resolve(projectId);
  }

  automationUrl(): Promise<string> {
    return Promise.resolve("");
  }

  onCeilingBreach(): void {
    this.logger.warn({}, "an automation reached its daily persist ceiling");
  }

  onAutoPaused(reason: string): void {
    this.logger.warn({ reason }, "an automation was paused by containment");
  }

  onContainmentFailed(): void {
    this.logger.warn({}, "automation containment could not complete");
  }

  error(fields: Record<string, unknown>, message: string): void {
    this.logger.error(fields, message);
  }

  info(fields: Record<string, unknown>, message: string): void {
    this.logger.info(fields, message);
  }
}

/** A test fire goes out over the worker's transports, never this process's. */
class UndeliverableApiTestFire extends AutomationTestFire {
  sendEmail(): Promise<void> {
    return Promise.reject(new ApiAutomationUnavailableError("send a test email"));
  }

  sendSlack(): Promise<void> {
    return Promise.reject(new ApiAutomationUnavailableError("send a test Slack message"));
  }

  sendSlackBot(): Promise<void> {
    return Promise.reject(new ApiAutomationUnavailableError("send a test Slack message"));
  }

  sendWebhook(): Promise<{ status: number }> {
    return Promise.reject(new ApiAutomationUnavailableError("send a test webhook"));
  }
}

/**
 * {@link AutomationProviderSecrets} over the registry, renaming its
 * `findDecryptedSlackBotToken` to the authoring surface's `findSlackBotToken` —
 * the same read, under the name the two callers agree on.
 */
class AutomationProviderSecretsAdapter implements AutomationProviderSecrets {
  constructor(private readonly registry: AutomationProviderRegistryService) {}

  actionParamsSchemaFor(action: AutomationAction) {
    return this.registry.actionParamsSchemaFor(action);
  }

  persistActionParamsFor(
    action: AutomationAction,
    args: Readonly<{ incoming: Record<string, unknown>; loadExisting: () => Promise<unknown> }>,
  ) {
    return this.registry.persistActionParamsFor(action, args);
  }

  redactActionParamsFor(action: AutomationAction, params: unknown) {
    return this.registry.redactActionParamsFor(action, params);
  }

  findSlackBotToken(actionParams: unknown): string | null {
    return this.registry.findDecryptedSlackBotToken(actionParams);
  }

  decryptWebhookHeaders(stored: AutomationWebhookStoredParams): Record<string, string> {
    return this.registry.decryptWebhookHeaders(stored);
  }

  decryptWebhookSigningSecrets(stored: AutomationWebhookStoredParams): readonly string[] {
    return this.registry.decryptWebhookSigningSecrets(stored);
  }
}

/**
 * The Slack conversations a bot token can see, absent: listing a
 * workspace's channels is a live call to Slack's API, and this process
 * makes none.
 */
class UnavailableAutomationSlackDirectory implements AutomationSlackDirectory {
  list(): Promise<SlackChannelListing> {
    return Promise.reject(
      new ApiAutomationUnavailableError(
        "run a Slack transport, so it cannot list a workspace's channels",
      ),
    );
  }
}

/**
 * ADR-043's filter-query dry run, absent: no compiler for this facet exists
 * yet on either process, so a non-empty `filterQuery` cannot be saved until
 * one is built. A real gap, not a parity loss.
 */
class UnwiredAutomationTraceFilterCompiler implements AutomationTraceFilterCompiler {
  assertCompiles(): void {
    throw new ApiAutomationUnavailableError("validate a trace filter query");
  }
}

const REDIS_CALL_COUNTER_PREFIX = "automation:call-counter:";

/**
 * Per-key fixed-window counting for automation's multi-policy throttles
 * (test-fire, webhook flood, unsubscribe — ADR-031, ADR-040 §4): each call
 * names its own window and ceiling, unlike the boot-fixed `rateLimiter`.
 */
class RedisAutomationCallCounter implements AutomationCallCounter {
  constructor(private readonly redis: RedisConnection) {}

  async count(
    input: Readonly<{ key: string; windowSeconds: number; max: number }>,
  ): Promise<Readonly<{ allowed: boolean; resetAt: number }>> {
    const redisKey = `${REDIS_CALL_COUNTER_PREFIX}${input.key}`;
    const count = await this.redis.incr(redisKey);
    if (count === 1) {
      await this.redis.expire(redisKey, input.windowSeconds);
    }
    const ttl = await this.redis.ttl(redisKey);
    return {
      allowed: count <= input.max,
      resetAt: nowInstant().epochMilliseconds + (ttl > 0 ? ttl : input.windowSeconds) * 1000,
    };
  }
}

/**
 * The webhook dispatch cap, counted in Redis under main's key prefix: a different
 * key would spend a budget the platform's own limiter protects.
 */
class RedisWebhookDispatchRateLimiter extends WebhookDispatchRateLimiter {
  constructor(private readonly connection: RedisConnection) {
    super();
  }

  async limit(
    input: Readonly<{ key: string; windowSeconds: number; max: number }>,
  ): Promise<WebhookDispatchRateLimitResult> {
    const redisKey = `langwatch:ratelimit:${input.key}`;
    const count = await this.connection.incr(redisKey);
    if (count === 1) {
      await this.connection.expire(redisKey, input.windowSeconds);
    }
    const ttl = await this.connection.ttl(redisKey);
    return {
      allowed: count <= input.max,
      remaining: Math.max(0, input.max - count),
      resetAt: nowInstant().epochMilliseconds + (ttl > 0 ? ttl : input.windowSeconds) * 1000,
    };
  }
}

/** {@link AutomationAuditSink} over the SAME audit trail every other mutation is recorded on. */
class AuditLogAutomationAuditSink implements AutomationAuditSink {
  constructor(private readonly auditLog: AuditLogApi) {}

  async record(
    entry: Readonly<{ userId: string; projectId?: string; action: string; args?: unknown }>,
  ): Promise<void> {
    await this.auditLog.record({
      userId: entry.userId,
      ...(entry.projectId === undefined ? {} : { projectId: entry.projectId }),
      action: entry.action,
      ...(entry.args === undefined ? {} : { args: entry.args as RecordAuditLogCommand["args"] }),
    });
  }
}

/** Every table this feature's settlement half reads or writes. */
export type AutomationSettlementDatabase = AutomationSettlementLedgerDatabase &
  TriggerDatabase &
  GraphTriggerSentDatabase &
  WebhookDeliveryDatabase;

/**
 * Where the daily persist ceiling comes from: a number this deployment stated,
 * or the plan a project's organization is actually on.
 */
export type AutomationPersistCeiling =
  | Readonly<{ kind: "fixed"; cap: number }>
  | Readonly<{
      kind: "plan";
      projects: ProjectApi;
      plans: EntitlementApi;
      free: number;
      paid: number;
      enterprise: number;
    }>;

/** Everything containment reads, once the ledger it filters through exists. */
export type AutomationRunawayCollaborator = AutomationRunaway &
  AutomationRunawayNotice &
  AutomationRunawaySignals;

/**
 * This feature's settlement half, as the composing process's pipeline mounts it.
 */
export type AutomationSettlement = Readonly<{
  /** What a settled intent is carried out by. */
  settlement: AutomationSettlementExecutor;
  /** The two schedules the pipeline drives, and the graph re-check one reaches. */
  scheduledIntents: AutomationScheduledIntent;
}>;

/**
 * Settlement, composed over substrates the process owns. Containment
 * shares the ledger's suppression rows with a digest, so the runaway
 * collaborator arrives as a callback, keeping that table to one reader.
 */
export function createAutomationSettlement(input: {
  /** The one database client the composing process opened. */
  prisma: AutomationSettlementDatabase;
  clock: AutomationClock;
  /** Where the daily ceiling counts: a Redis one counts fleet-wide. */
  persistCapSlots: AutomationPersistCapRepository;
  projects: AutomationProjectDirectory;
  traces: AutomationSettlementTraceReader;
  evaluations: AutomationSettlementEvaluationReader;
  /** How a saved automation's own filters are re-checked against the trace it matched. */
  traceFilters: AutomationSettlementTraceFilters;
  evaluationFilters: AutomationSettlementEvaluationFilters;
  /** `ADD_TO_DATASET`'s row mapping, and the two persist writes. */
  mapper: AutomationDatasetMapper;
  writer: AutomationPersistActionWriter;
  /**
   * The process's outbound transports, the ceilings they spend, and the cipher
   * they read secrets with.
   */
  delivery: AutomationNotificationDelivery;
  emailCaps: AutomationEmailCapService;
  crypto: AutomationSecretCrypto;
  /** The deployment's own origin; every link in a digest is built from it. */
  baseHost: string;
  observability: AutomationSettlementObservability;
  /**
   * What this process does about an automation past its ceiling when it
   * composed no containment.
   */
  breach: AutomationSettlementBreach;
  /** Reads the recency the heartbeat sweep decides absence from. */
  analytics: Pick<AnalyticsApi, "findLastOccurredAt">;
  logger: AutomationLogger;
  /** The graph half, when this process composed one. */
  graphActivity?: AutomationGraphActivity | undefined;
  persistCeiling: AutomationPersistCeiling;
  emailHourlyCap: number;
  tenantDailyCap: number;
  /**
   * Builds containment over the suppression rows the ledger owns. Absent leaves
   * a breach logged and nobody notified, which is what a process with no
   * outbound mail or no tenancy can honestly do.
   */
  createRunaway?:
    | ((suppression: AutomationSettlementLedgerService) => AutomationRunawayCollaborator)
    | undefined;
}): AutomationSettlement {
  const { prisma, clock } = input;
  // The ceiling's tier, resolved through this feature's own cap service so that
  // the hop from project to organization, the contract override and the
  // ten-minute cache are the ones the interactive process uses. Only the
  // resolution is taken: the COUNTING stays on the ledger's shared slot, and two
  // services counting the same slot would give one fleet two tallies.
  const persistCaps =
    input.persistCeiling.kind === "plan"
      ? AutomationPersistCapService.create({
          projects: input.persistCeiling.projects,
          planProvider: input.persistCeiling.plans,
          slots: input.persistCapSlots,
          config: {
            free: input.persistCeiling.free,
            paid: input.persistCeiling.paid,
            enterprise: input.persistCeiling.enterprise,
          },
        })
      : undefined;

  let containment: RunawayContainmentService | undefined;
  const ledger = PrismaAutomationSettlementLedgerRepository.create({
    prisma,
    clock,
    persistCaps: input.persistCapSlots,
    persistCap: persistCaps
      ? { kind: "resolved", resolve: (projectId) => persistCaps.resolvePersistDailyCap(projectId) }
      : { kind: "fixed", cap: statedCeiling(input.persistCeiling) },
    breach: new LateContainmentBreach(input.breach, () => containment),
  });

  const createRunaway = input.createRunaway;
  if (createRunaway) {
    containment = RunawayContainmentService.create({
      runaway: createRunaway(ledger),
      triggers: PrismaTriggerRepository.create(prisma, clock),
      clock,
    });
  }

  return {
    settlement: AutomationSettlementDispatchService.create({
      automation: ledger,
      projects: input.projects,
      traces: input.traces,
      baseHost: input.baseHost,
      confirmation: AutomationSettlementMatchConfirmationService.create({
        evaluations: input.evaluations,
        traces: input.traces,
        traceFilters: input.traceFilters,
        evaluationFilters: input.evaluationFilters,
      }),
      persistActions: AutomationPersistActionService.create({
        automation: ledger,
        projects: input.projects,
        traces: input.traces,
        mapper: input.mapper,
        writer: input.writer,
      }),
      delivery: input.delivery,
      emailCaps: input.emailCaps,
      slack: AutomationSlackSecretsService.create(input.crypto),
      webhooks: AutomationWebhookSecretsService.create(input.crypto),
      clock,
      observability: input.observability,
      emailHourlyCap: input.emailHourlyCap,
      tenantDailyCap: input.tenantDailyCap,
    }),
    scheduledIntents: new ComposedScheduledIntents(
      GraphTriggerHeartbeatService.create({
        triggers: PrismaTriggerRepository.create(prisma, clock),
        triggerSent: PrismaGraphTriggerSentRepository.create(prisma),
        analytics: input.analytics,
        logger: input.logger,
      }),
      PrismaWebhookDeliveryRepository.create(prisma),
      input.graphActivity,
    ),
  };
}

/** The paid ceiling, stated rather than resolved. See the config leaf. */
function statedCeiling(ceiling: AutomationPersistCeiling): number {
  return ceiling.kind === "fixed" ? ceiling.cap : ceiling.paid;
}

/**
 * The breach handler, resolved LATE: containment reads suppression rows
 * off the ledger this port is handed to, so the thunk is the knot, not an
 * optional. Absent containment, this process's own report stands.
 */
class LateContainmentBreach extends AutomationSettlementBreach {
  constructor(
    private readonly reported: AutomationSettlementBreach,
    private readonly resolve: () => RunawayContainmentService | undefined,
  ) {
    super();
  }

  async handle(breach: AutomationPersistCapBreach): Promise<void> {
    const containment = this.resolve();
    if (containment) return containment.handle(breach);

    return this.reported.handle(breach);
  }
}

/**
 * The two schedules, and the graph re-check one of them drives.
 */
class ComposedScheduledIntents extends AutomationScheduledIntent {
  constructor(
    private readonly heartbeat: GraphTriggerHeartbeatService,
    private readonly deliveries: { pruneExpired(now?: Instant): Promise<number> },
    private readonly graphActivity: AutomationGraphActivity | undefined,
  ) {
    super();
  }

  decideGraphTriggerHeartbeat(now: { now: Instant }): Promise<GraphTriggerSweepCandidate[]> {
    return this.heartbeat.decide(now);
  }

  evaluateGraphTrigger(candidate: {
    triggerId: string;
    projectId: string;
    reason: GraphTriggerEvaluationReason;
  }): Promise<GraphTriggerEvaluationResult> {
    if (!this.graphActivity) {
      return Promise.reject(
        new DispatchError({
          message:
            "This process composes no graph-alert vertical, so a sweep candidate cannot be evaluated here. Set BASE_HOST to compose one.",
          retryable: false,
        }),
      );
    }

    return this.graphActivity.evaluateGraphTrigger(candidate);
  }

  pruneWebhookDeliveries(now?: Instant): Promise<number> {
    return this.deliveries.pruneExpired(now);
  }
}

/** `ADD_TO_DATASET`'s row mapping, through dataset's own trace mapping (main's worker mapper). */
export class DatasetTraceMapper extends AutomationDatasetMapper {
  map(input: {
    trace: TraceRecord;
    mapping: DatasetActionParams["datasetMapping"]["mapping"];
    expansions: readonly string[];
  }): Record<string, string | number>[] {
    const expansions = new Set(
      input.expansions.filter(
        (value): value is keyof typeof TRACE_EXPANSIONS => value in TRACE_EXPANSIONS,
      ),
    );
    return mapTraceToDatasetEntry(traceSchema.parse(input.trace), input.mapping, expansions);
  }
}

const ANNOTATOR_REFERENCE_INVALID = "annotation_annotator_reference_invalid";

/** The two persist writes, through the dataset and annotation owners' own operations. */
export class PeerPersistActionWriter extends AutomationPersistActionWriter {
  constructor(
    private readonly peers: Readonly<{
      datasets: Pick<DatasetApi, "batchCreateRecords">;
      annotations: Pick<AnnotationApi, "queueTraces">;
    }>,
  ) {
    super();
  }

  async addToAnnotationQueue(input: {
    traceIds: string[];
    projectId: string;
    annotators: string[];
    userId: string;
  }): Promise<void> {
    try {
      await this.peers.annotations.queueTraces(input);
    } catch (error) {
      // The annotator is saved on the automation, so a malformed one fails every redelivery.
      if (readCode(error) !== ANNOTATOR_REFERENCE_INVALID) throw error;
      throw new DispatchError({
        message:
          "This automation names an annotator that parses as neither a queue nor a member, so a queue item cannot be written for it. Re-save the automation with a queue or a member that still exists.",
        retryable: false,
      });
    }
  }

  async addToDataset(input: {
    datasetId: string;
    projectId: string;
    datasetRecords: DatasetRecordEntry[];
  }): Promise<void> {
    await this.peers.datasets.batchCreateRecords({
      slugOrId: input.datasetId,
      projectId: input.projectId,
      entries: input.datasetRecords,
    });
  }
}

function readCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

/**
 * A breach with no containment composed: logged, nobody notified, nothing paused
 * (main's WorkerSettlementBreach; containment is a named parity gap).
 */
export class LoggedSettlementBreach extends AutomationSettlementBreach {
  constructor(private readonly logger: AutomationLogger) {
    super();
  }

  handle(input: AutomationPersistCapBreach): Promise<void> {
    this.logger.error(
      {
        projectId: input.projectId,
        triggerId: input.trigger.id,
        cap: input.cap,
        count: input.count,
        skipped: input.skipped,
      },
      "Automation passed its daily ceiling on confirmed matches and further matches are being skipped; this process composed no containment, so nobody has been notified and the automation has not been paused",
    );
    return Promise.resolve();
  }
}
