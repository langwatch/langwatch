import type { AlertType, AutomationLimitNextStep, DatasetActionParams, GraphTriggerEvaluationReason, GraphTriggerEvaluationResult, GraphTriggerSweepCandidate, SlackActionParams, SlackPayload, TriggerMatchRecordedEventData, TriggerSummary, WebhookActionParams, WebhookDeliveryInput } from "@langwatch/automation-contract";
import type { Instant } from "@langwatch/time";
export interface AutomationInfrastructure {  automationClock: AutomationClockPort;
  automationDatasetMapper: AutomationDatasetMapperPort;
  automationDispatchError: AutomationDispatchErrorPort;
  automationEmailCapStore: AutomationEmailCapStorePort;
  automationEvaluationQueryClassification: AutomationEvaluationQueryClassificationPort;
  automationEvaluationTraceSummary: AutomationEvaluationTraceSummaryPort;
  automationEvaluationTriggerFilter: AutomationEvaluationTriggerFilterPort;
  automationGraphActivity: AutomationGraphActivityPort;
  automationGraphDelivery: AutomationGraphDeliveryPort;
  automationGraphNotifier: AutomationGraphNotifierPort;
  automationHeartbeat: AutomationHeartbeatPort;
  automationIntentRetention: AutomationIntentRetentionPort;
  automationLogger: AutomationLoggerPort;
  automationNotificationDelivery: AutomationNotificationDeliveryPort;
  automationPersistActionWriter: AutomationPersistActionWriterPort;
  automationProjectIdentity: AutomationProjectIdentityPort;
  automationRunaway: AutomationRunawayPort;
  automationScheduledIntent: AutomationScheduledIntentPort;
  automationSlackBotTokenDecryptor: AutomationSlackBotTokenDecryptorPort;
  automationSlackProvider: AutomationSlackProviderPort;
  automationTestFire: AutomationTestFirePort;
  automationTraceTriggerCatalogue: AutomationTraceTriggerCataloguePort;
  automationTriggerMatchRecorder: AutomationTriggerMatchRecorderPort;
  automationWebhookProvider: AutomationWebhookProviderPort;
  scheduledJobStore: ScheduledJobStorePort;
  schedulerWake: SchedulerWakePort;
  unsubscribeTokenVerifier: UnsubscribeTokenVerifierPort;
}


export interface AutomationClockPort {
  now(): Instant;
}


export interface AutomationEvaluationTriggerFilterPort {
  readsEvaluations(input: {
    filters: Record<string, unknown>;
    filterQuery: string | null;
  }): boolean;
}


export interface AutomationTriggerMatchRecorderPort {
  send(
    input: TriggerMatchRecordedEventData & {
      tenantId: string;
      occurredAt: number;
    },
  ): Promise<void>;
}

/**
 * The ONE trace read the evaluation alert subscriber makes.
 *
 * A trace summary, to address the alert with the trace it is about. Narrower
 * than `TraceService`, which that read used to be named through: the full
 * capability carries the list, span, media and protection paths a background
 * subscriber never touches, and `TraceService` satisfies this port
 * structurally so an application composition is unchanged.
 */
export interface AutomationEvaluationTraceSummaryPort {
  tryGetSummary(input: {
    projectId: string;
    traceId: string;
  }): Promise<TraceSummaryData | null>;
}

/**
 * Whether a saved filter query reads evaluations at all.
 *
 * Synchronous because the published service's is: classification is a parse
 * of the customer's own query text, not a read. Narrowed off `TraceService`
 * for the same reason the summary read is, and satisfied by it structurally.
 */
export interface AutomationEvaluationQueryClassificationPort {
  classifyQuery(input: { query: string }): TraceQueryClassification;
}

/**
 * The two questions the real-time graph-alert path asks Automation.
 *
 * Trace's `graphTriggerActivity` subscriber runs on every trace that lands: it
 * asks which of a project's automations watch a custom graph, and then asks for
 * each of them to be re-evaluated. Those two calls are the ENTIRE dependency
 * that pipeline has on this feature — no writes, no schedules, no test fires,
 * no cap accounting.
 *
 * Narrowing them to a port is what breaks a cycle. The subscriber used to name
 * `AutomationService`, the whole capability, which drags report scheduling,
 * template test fires and the persist-cap ledger behind it; a process that
 * wanted only the two methods had to compose all of it or none. The published
 * `AutomationService` satisfies this port structurally, so the application
 * keeps passing exactly what it passed before, while a background process can
 * compose the graph half alone (`PostgresAutomationGraphActivityAdapter`).
 *
 * Deliberately NOT here: `decideGraphTriggerHeartbeat` and
 * `handlePersistCapBreach`. Both are graph-shaped and both look like they
 * belong, and neither is on this path — the heartbeat is the sweep process's
 * question and needs a ClickHouse recency read, containment is the persist
 * ledger's and needs a runaway notifier. Adding either would make every
 * implementer supply a collaborator the caller never reaches.
 */
export interface AutomationGraphActivityPort {
  /**
   * The project's active automations that watch a custom graph.
   *
   * Reports only, and never a REPORT-kind automation: a report is a schedule,
   * not an alert, and re-evaluating one on trace activity would fire it off
   * calendar.
   */
  getActiveGraphTriggersForProject(projectId: string): Promise<TriggerSummary[]>;

  /**
   * Re-evaluates one graph automation and dispatches an alert if it fired.
   *
   * Idempotent by its own open/resolve bookkeeping rather than by the caller's:
   * the subscriber's retry, the heartbeat sweep and a manual re-run all land
   * here, and the same incident must not notify twice.
   */
  evaluateGraphTrigger(input: {
    triggerId: string;
    projectId: string;
    reason: GraphTriggerEvaluationReason;
  }): Promise<GraphTriggerEvaluationResult>;
}

/**
 * The project read a graph alert is addressed with.
 *
 * A dispatched alert names the project it is about — its name in the subject
 * line, its slug in every link back to the deployment — and that is the entire
 * project question the graph path asks. Naming it here rather than taking a
 * whole `ProjectApi` is the same narrowing this file already does for
 * Automation itself: the write graph behind `ProjectApi` drags a
 * credentials port, an organization service and, through it, an authz service
 * into a process that only sends an alert. `ProjectApi` and
 * `ProjectMetadataService` both satisfy this.
 */
export interface AutomationProjectIdentityPort {
  tryGetById(projectId: string): Promise<{
    id: string;
    name: string;
    slug: string;
  } | null>;
}

/**
 * Automation-owned persistence operations used by the host's graph delivery
 * adapter. Keeping this nominal boundary prevents composition from reaching
 * into the process service while it is being constructed.
 */
export interface AutomationGraphDeliveryPort {
  filterSuppressed(input: {
    projectId: string;
    triggerId: string;
    emails: string[];
  }): Promise<string[]>;
  isSendClaimed(input: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }): Promise<boolean>;
  claimSend(input: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }): Promise<boolean>;
  recordWebhookDelivery(input: WebhookDeliveryInput): Promise<void>;
}

export type GraphAlertDispatchInput = {
  trigger: Trigger;
  project: { id: string };
  context: GraphAlertTemplateContext;
  recipients: string[];
  slackWebhook: string | null;
  botDestination?: { token: string; channel: string } | null;
  fireDigest: string;
};

export type GraphAlertDispatchResult = {
  channel: "email" | "slack" | "webhook" | "none";
  didSend: boolean;
  missingVariables: string[];
  renderErrors: string[];
};

/** Technical delivery boundary owned by the process composition root. */
export interface AutomationGraphNotifierPort {
  dispatch(input: GraphAlertDispatchInput): Promise<GraphAlertDispatchResult>;
}

/** Process logger used by graph evaluation and heartbeat isolation. */
export interface AutomationLoggerPort {
  error(fields: Record<string, unknown>, message: string): void;
  debug(fields: Record<string, unknown>, message: string): void;
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
}

/** Technical ClickHouse resolver used only by the heartbeat recency query. */
export interface AutomationHeartbeatPort {
  tryResolveClickHouseClient(projectId: string): Promise<ClickHouseClient | null>;
}

/** Host crypto boundary for stored Slack bot credentials. */
export interface AutomationSlackBotTokenDecryptorPort {
  tryDecrypt(params: SlackActionParams): string | null;
}

/** Host transport semantics for retryable and terminal delivery failures. */
export interface AutomationDispatchErrorPort {
  isTerminal(error: unknown): boolean;
  createTerminal(message: string): unknown;
}

export type AutomationGraphNotifierInput = GraphAlertDispatchInput;

export type AutomationGraphNotifierResult = GraphAlertDispatchResult;


export interface AutomationIntentRetentionPort {
  deleteDispatchedBefore(input: { processName: string; before: number }): Promise<number>;
}

/** Outbound provider calls. Automation owns when and what to send; the process
 * adapter owns SDKs, HTTP policy, mail rendering infrastructure, and secrets. */
export interface AutomationNotificationDeliveryPort {
  /** The established transactional-mail renderer remains a host delivery
   * adapter; Automation decides when a legacy digest is sent. */
  sendLegacyEmail(input: {
    recipients: string[];
    triggerData: Array<{
      traceId: string;
      input: string;
      output: string;
      projectId: string;
      fullTrace: TraceRecord;
    }>;
    triggerName: string;
    triggerId: string;
    projectId: string;
    projectSlug: string;
    triggerType: AlertType | null;
    triggerMessage: string;
    isRecipientSent(recipientHash: string): Promise<boolean>;
    recordRecipientSent(recipientHash: string): Promise<void>;
  }): Promise<void>;

  sendEmail(input: {
    recipients: string[];
    triggerId: string;
    projectId: string;
    subject: string;
    html: string;
    isRecipientSent(recipientHash: string): Promise<boolean>;
    recordRecipientSent(recipientHash: string): Promise<void>;
  }): Promise<void>;

  sendSlackWebhook(input: {
    webhook: string;
    triggerName: string;
    payload: SlackPayload;
  }): Promise<void>;

  sendLegacySlackWebhook(input: {
    webhook: string;
    triggerData: Array<{
      traceId: string;
      input: string;
      output: string;
      projectId: string;
      fullTrace: TraceRecord;
    }>;
    triggerName: string;
    projectSlug: string;
    triggerType: AlertType | null;
    triggerMessage: string;
    baseHost: string;
  }): Promise<void>;

  sendSlackBot(input: {
    token: string;
    channel: string;
    payload: SlackPayload;
    triggerName: string;
  }): Promise<void>;

  sendWebhook(input: WebhookDeliveryRequest): Promise<WebhookSendResult>;
}


export interface AutomationDatasetMapperPort {
  map(input: {
    trace: TraceRecord;
    mapping: DatasetActionParams["datasetMapping"]["mapping"];
    expansions: readonly string[];
  }): Array<Record<string, string | number>>;
}


export interface AutomationPersistActionWriterPort {
  addToAnnotationQueue(input: {
    traceIds: string[];
    projectId: string;
    annotators: string[];
    userId: string;
  }): Promise<void>;

  addToDataset(input: {
    datasetId: string;
    projectId: string;
    datasetRecords: DatasetRecordEntry[];
  }): Promise<void>;
}

export type AutomationWebhookStoredParams = {
  url: string;
  method: WebhookActionParams["method"];
  bodyTemplate: string | null;
  headersEncrypted?: string;
  headers?: Record<string, string>;
  signingSecretEncrypted?: string;
  previousSigningSecretEncrypted?: string;
  previousSigningSecretExpiresAt?: number;
};


export interface AutomationSlackProviderPort {
  tryDecrypt(params: { slackBotToken?: string }): string | null;
}


export interface AutomationWebhookProviderPort {
  parseStored(value: unknown): AutomationWebhookStoredParams;

  decryptHeaders(params: {
    headersEncrypted?: string;
    headers?: Record<string, string>;
  }): Record<string, string>;

  decryptSigningSecrets(
    params: {
      signingSecretEncrypted?: string;
      previousSigningSecretEncrypted?: string;
      previousSigningSecretExpiresAt?: number;
    },
    now?: Instant,
  ): string[];

  persist(input: {
    incoming: WebhookActionParams;
    existing?: AutomationWebhookStoredParams | null;
  }): AutomationWebhookStoredParams;

  redact(params: AutomationWebhookStoredParams): WebhookActionParams;
}

export type ClaimLease = { key: string; token: string };

/** Explicit infrastructure ports used by Automation's containment policy. */
export interface AutomationRunawayPort {
  countProjectTraces24h(projectId: string): Promise<number>;
  notificationRecipients(params: {
    projectId: string;
    triggerId: string;
  }): Promise<string[]>;
  sendLimitEmail(params: {
    to: string[];
    kind: LimitEmailKind;
    automationName: string;
    projectName: string;
    dailyCeiling: number;
    skippedToday: number;
    actionUrl: string;
    /** Only ever passed for a `ceiling_reached` notice. */
    nextStep?: AutomationLimitNextStep;
  }): Promise<void>;
  /**
   * Where this project's organization can go for a higher ceiling. Called
   * only for a `ceiling_reached` breach, never for a pause.
   */
  resolveNextStep(projectId: string): Promise<AutomationLimitNextStep | undefined>;
  tryClaimOnce(key: string, ttlSeconds?: number): Promise<ClaimLease | null>;
  releaseClaim(lease: ClaimLease): Promise<void>;
  projectName(projectId: string): Promise<string>;
  automationUrl(params: { projectId: string; triggerId: string }): Promise<string>;
  onCeilingBreach(): void;
  onAutoPaused(reason: string): void;
  onContainmentFailed(): void;
  error(fields: Record<string, unknown>, message: string): void;
  info(fields: Record<string, unknown>, message: string): void;
}


export interface AutomationScheduledIntentPort {
  decideGraphTriggerHeartbeat(input: {
    now: Instant;
  }): Promise<GraphTriggerSweepCandidate[]>;

  evaluateGraphTrigger(input: {
    triggerId: string;
    projectId: string;
    reason: GraphTriggerEvaluationReason;
  }): Promise<GraphTriggerEvaluationResult>;

  pruneWebhookDeliveries(now?: Instant): Promise<number>;
}

export interface TestFireEmail {
  recipients: string[];
  subject: string;
  html: string;
}

export interface TestFireSlackWebhook {
  webhook: string;
  payload: SlackPayload;
}

export interface TestFireSlackBot {
  token: string;
  channel: string;
  payload: SlackPayload;
}

export interface TestFireWebhook {
  url: string;
  method: "POST" | "PUT" | "PATCH";
  headers: Record<string, string>;
  signingSecrets?: readonly string[];
  body: string;
  triggerName: string;
}


export interface AutomationTestFirePort {
  sendEmail(input: TestFireEmail): Promise<void>;
  sendSlack(input: TestFireSlackWebhook): Promise<void>;
  sendSlackBot(input: TestFireSlackBot): Promise<void>;
  sendWebhook(input: TestFireWebhook): Promise<{ status: number }>;
}

/**
 * The one automation listing the trace-alert path reads.
 *
 * NOT the whole `AutomationService`, for the reason `AutomationProjectIdentityPort`
 * gives one file over: constructing that service means twelve collaborators —
 * report schedules, unsubscribe verification, webhook deliveries, persist caps,
 * the whole graph half — because its WRITE half needs them. Asking which of a
 * project's automations watch traces is a single cached repository read, and a
 * process that only ingests should not have to compose an authoring surface to
 * make it.
 *
 * `AutomationService` satisfies this, so the application's own composition is
 * unchanged and both graphs answer from the same implementation.
 */
export interface AutomationTraceTriggerCataloguePort {
  getActiveTraceTriggersForProject(projectId: string): Promise<TriggerSummary[]>;
}


export interface AutomationEmailCapStorePort {
  trySet(
    key: string,
    value: string,
    expiry: "EX",
    seconds: number,
    condition: "NX",
  ): Promise<string | null>;
  tryGet(key: string): Promise<string | null>;
  incr(key: string): Promise<number>;
  incrby(key: string, increment: number): Promise<number>;
  eval(script: string, keyCount: number, key: string, seconds: string): Promise<unknown>;
}

export type ScheduledJobRecord = {
  targetId: string;
  nextRunAt: Instant;
  lastSlot: Instant | null;
  active: boolean;
};


export interface ScheduledJobStorePort {
  upsertForTarget(input: {
    projectId: string;
    targetType: string;
    targetId: string;
    cron: string;
    timezone: string;
    nextRunAt: Instant;
  }): Promise<void>;
  deactivateForTarget(input: {
    projectId: string;
    targetType: string;
    targetId: string;
  }): Promise<void>;
  findAllForProject(input: {
    projectId: string;
    targetType: string;
  }): Promise<ScheduledJobRecord[]>;
}


export interface SchedulerWakePort {
  publish(): void;
}

export type UnsubscribeTokenPayload = {
  projectId: string;
  triggerId: string | null;
  email: string;
};


export interface UnsubscribeTokenVerifierPort {
  tryVerify(token: string): UnsubscribeTokenPayload | null;
}
