/**
 * Builds AutomationInfrastructure for the API process; implements reads/writes to trigger
 * rows, not evaluation/delivery/scheduling (those are the worker's responsibilities).
 */
import type { AuditLogApi, RecordAuditLogCommand } from "@langwatch/audit-log-contract";
import {
  ApiAutomationUnavailableError,
  type AutomationAction,
  type SlackActionParams,
  type SlackChannelListing,
} from "@langwatch/automation-contract";
import { PrismaScheduledJobStore, SchedulerService } from "@langwatch/eventing/server";
import type { Logger } from "@langwatch/observability";
import type { Encryption, ProcessMembers } from "@langwatch/process-stores/members";
import type { RedisConnection } from "@langwatch/redis-client";
import { fromDate, nowInstant, toDate, type Instant } from "@langwatch/time";

import type { AutomationGraphNotifier } from "../channels/automation-graph-alert.channel.ts";
import type { AutomationRunawayNotice } from "../channels/automation-runaway-notice.channel.ts";
import { SchedulerWake } from "../channels/automation-scheduler-wake.channel.ts";
import { AutomationTestFire } from "../channels/automation-test-fire.channel.ts";
import type { AutomationRunaway } from "../repositories/automation-runaway.repository.ts";
import type {
  AutomationScheduledJobRepository,
  ScheduledJobRecord,
} from "../repositories/automation-scheduled-job.repository.ts";
import type {
  AutomationDispatchError,
  AutomationHeartbeat,
  AutomationLogger,
} from "../services/automation-graph-runtime.service.ts";
import { AutomationProviderRegistryService } from "../services/automation-provider-registry.service.ts";
import type { AutomationRunawaySignals } from "../services/automation-runaway-signals.service.ts";
import type { AutomationSlackBotTokenDecryptor } from "../services/automation-slack-secrets.service.ts";
import type {
  AutomationAuditSink,
  AutomationCallCounter,
  AutomationInfrastructure,
  AutomationProviderSecrets,
  AutomationSlackDirectory,
  AutomationTraceFilterCompiler,
  AutomationWebhookStoredParams,
} from "./automation.app.ts";
import type { AutomationClock } from "./automation.members.ts";

/**
 * What `buildAutomationInfrastructure` reads off process members. The
 * unsubscribe key is not among them: `stores` owns `CREDENTIALS_SECRET`, and
 * the verifier built from it is what travels, never the key.
 */
export type AutomationProcessMembers = Readonly<{
  prisma: ProcessMembers["prisma"];
  redis: RedisConnection;
  logger: Logger;
  encryption: Encryption;
  publicBaseUrl: string | undefined;
  secrets: Readonly<{ find(key: string): string | undefined }>;
}>;

/** Builds the {@link AutomationInfrastructure} `AutomationApp.create` composes over. */
export function buildAutomationInfrastructure(input: {
  members: AutomationProcessMembers;
  auditLog: AuditLogApi;
  verifier: AutomationInfrastructure["verifier"];
}): AutomationInfrastructure {
  const { members } = input;
  const providers = AutomationProviderRegistryService.create(members.encryption);

  return {
    verifier: input.verifier,
    // The report calendar, on the SAME `ScheduledJob` store the worker's loop
    // claims a due row through — Eventing's own, not a second narrowing of it,
    // so the row this process writes on save is the row that process reads.
    jobs: new InstantScheduledJobRepository(new PrismaScheduledJobStore(members.prisma)),
    clock: new ApiAutomationClock(),
    wake: new ApiSchedulerWake(members.redis),
    notifier: new UndeliveredApiGraphAlerts(),
    logger: new ApiAutomationLogger(members.logger),
    slackTokens: new ApiAutomationSlackTokens(providers),
    dispatchErrors: new ApiAutomationDispatchErrors(),
    heartbeat: new UnmeasuredApiAutomationHeartbeat(),
    runaway: new UncontainedApiAutomationRunaway(members.logger),
    testFire: new UndeliverableApiTestFire(),
    redis: members.redis,
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

/** Graph alerts are dispatched by the worker, so this one refuses by name. */
class UndeliveredApiGraphAlerts implements AutomationGraphNotifier {
  dispatch(): never {
    throw new ApiAutomationUnavailableError("deliver graph alerts");
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

/** {@link AutomationAuditSink} over the SAME audit trail every other mutation is recorded on. */
class AuditLogAutomationAuditSink implements AutomationAuditSink {
  constructor(private readonly auditLog: AuditLogApi) {}

  record(
    entry: Readonly<{ userId: string; projectId?: string; action: string; args?: unknown }>,
  ): Promise<void> {
    return this.auditLog.record({
      userId: entry.userId,
      ...(entry.projectId === undefined ? {} : { projectId: entry.projectId }),
      action: entry.action,
      ...(entry.args === undefined ? {} : { args: entry.args as RecordAuditLogCommand["args"] }),
    });
  }
}
