/**
 * The public-API rig every `/api/triggers` suite drives: the real transport,
 * the real public-API service, the real provider registry over a marking
 * cipher, and Slack connections over an in-memory double. Rows live in a map.
 */
import {
  automationRestFirePageSchema,
  automationRestResponseSchema,
  TriggerAction,
  type AutomationApi,
  type CreateTriggerCommand,
  type TestFireInput,
  type TestFireResult,
  type Trigger,
  type UpdateTriggerCommand,
} from "@langwatch/automation-contract";
import type { Evaluator } from "@langwatch/evaluator-contract";
import type { SlackConnectionSecret, SlackConnectionView } from "@langwatch/slack-contract";
import { vi } from "vitest";
import { z } from "zod";

import { SilentLogger } from "../../__tests__/fixtures/graph-activity.fixture.ts";
import { sealWith } from "../../__tests__/fixtures/trigger-secrets.fixture.ts";
import { MemoryAutomationStore } from "../../repositories/memory/memory.automation.store.ts";
import { MemoryTriggerFireHistoryRepository } from "../../repositories/memory/memory.trigger-fire-history.repository.ts";
import { AutomationProviderRegistryService } from "../../services/automation-provider-registry.service.ts";
import {
  AutomationPublicApiService,
  type AutomationPublicApiRows,
} from "../../services/automation-public-api.service.ts";
import { AutomationSlackConnectionService } from "../../services/automation-slack-connection.service.ts";
import { SlackDestinationService } from "../../services/slack-destination.service.ts";
import { TriggerFilterValidationService } from "../../services/trigger-filter-validation.service.ts";
import { mountAutomationRest, TEST_PROJECT } from "./automation-rest.harness.ts";

/** A cipher whose ciphertext is visibly not the value, so a leak is a readable assertion. */
export const MARKING_CRYPTO = {
  encrypt: (value: string) => `enc(${Buffer.from(value).toString("base64")})`,
  decrypt: (value: string) => {
    const match = /^enc\((.*)\)$/.exec(value);
    if (!match?.[1]) throw new Error("not a ciphertext this cipher wrote");
    return Buffer.from(match[1], "base64").toString("utf8");
  },
};

export const SECRETS = {
  webhookUrl: "https://hooks.slack.com/services/T0/B0/secret-url",
  botToken: "xoxb-secret-token",
  headerValue: "Bearer header-secret",
  signingSecret: "whsec-signing-secret",
} as const;

/** A connection the project can use, by id. */
export interface RigConnection {
  view: Pick<SlackConnectionView, "id" | "kind">;
  secret: SlackConnectionSecret;
}

function connectionView(connection: RigConnection): SlackConnectionView {
  return {
    ...connection.view,
    name: connection.view.id,
    scopeType: "PROJECT",
    scopeId: TEST_PROJECT.id,
    scopeName: "Acme",
    secretHint: "****",
    slackTeamId: null,
    slackTeamName: null,
    dependentAutomations: 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

export function triggerRow(overrides: Partial<Trigger> & Pick<Trigger, "id" | "action">): Trigger {
  return {
    projectId: TEST_PROJECT.id,
    name: "Error spike",
    triggerKind: "AUTOMATION",
    actionParams: {},
    filters: { "traces.error": ["true"] },
    filterQuery: null,
    active: true,
    deleted: false,
    pausedReason: null,
    pausedAt: null,
    message: null,
    alertType: null,
    customGraphId: null,
    notificationCadence: "immediate",
    traceDebounceMs: 0,
    templates: {
      slackTemplateType: null,
      slackTemplate: null,
      emailSubjectTemplate: null,
      emailBodyTemplate: null,
    },
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-01T00:00:00Z"),
    lastRunAt: null,
    ...overrides,
  };
}

function created(command: CreateTriggerCommand): Trigger {
  return triggerRow({
    id: command.id ?? "trigger_new",
    action: command.action,
    name: command.name,
    triggerKind: command.triggerKind ?? "AUTOMATION",
    actionParams: command.actionParams,
    filters: command.filters ?? {},
    filterQuery: command.filterQuery ?? null,
    message: command.message ?? null,
    alertType: command.alertType ?? null,
    customGraphId: command.customGraphId ?? null,
    traceDebounceMs: command.traceDebounceMs ?? 0,
    templates: {
      slackTemplateType: command.slackTemplateType ?? null,
      slackTemplate: command.slackTemplate ?? null,
      emailSubjectTemplate: command.emailSubjectTemplate ?? null,
      emailBodyTemplate: command.emailBodyTemplate ?? null,
    },
  });
}

function updated(row: Trigger, command: UpdateTriggerCommand): Trigger {
  const {
    id: _id,
    projectId: _projectId,
    slackTemplateType,
    slackTemplate,
    emailSubjectTemplate,
    emailBodyTemplate,
    notificationCadence: _cadence,
    ...columns
  } = command;
  return {
    ...row,
    ...columns,
    templates: {
      slackTemplateType:
        slackTemplateType === undefined ? row.templates.slackTemplateType : slackTemplateType,
      slackTemplate: slackTemplate === undefined ? row.templates.slackTemplate : slackTemplate,
      emailSubjectTemplate:
        emailSubjectTemplate === undefined
          ? row.templates.emailSubjectTemplate
          : emailSubjectTemplate,
      emailBodyTemplate:
        emailBodyTemplate === undefined ? row.templates.emailBodyTemplate : emailBodyTemplate,
    },
  };
}

export function createPublicApiRig(
  options: {
    rows?: Trigger[];
    connections?: RigConnection[];
    evaluatorIds?: string[];
    monitorsByEvaluator?: Record<string, string[]>;
    graphIds?: string[];
    testFireResult?: TestFireResult;
  } = {},
) {
  const rows = new Map((options.rows ?? []).map((row) => [row.id, row]));
  const store = MemoryAutomationStore.create();
  const connections = new Map(
    (options.connections ?? []).map((connection) => [connection.view.id, connection]),
  );
  const createdConnections: { kind: string; secret: string }[] = [];
  const slack = {
    getUsableSlackConnection: async ({ id }: { id: string; projectId: string }) => {
      const connection = connections.get(id);
      if (!connection) throw new Error(`no usable connection ${id}`);
      return connectionView(connection);
    },
    findUsableSlackSecret: async ({ id }: { id: string; projectId: string }) => {
      const connection = connections.get(id);
      return connection ? [connection.secret] : [];
    },
    findOrCreateSlackConnectionForSecret: async (input: {
      kind: "BOT" | "INCOMING_WEBHOOK";
      secret: string;
    }) => {
      const id = `slackintegration_${createdConnections.length + 1}`;
      createdConnections.push({ kind: input.kind, secret: input.secret });
      connections.set(id, {
        view: { id, kind: input.kind },
        secret:
          input.kind === "BOT"
            ? { kind: "BOT", token: input.secret }
            : { kind: "INCOMING_WEBHOOK", url: input.secret },
      });
      return { id, wasCreated: true };
    },
    claimConnection: async () => {},
    releaseConnection: async () => {},
  };
  const testFire = vi.fn(
    async (_input: TestFireInput): Promise<TestFireResult> =>
      options.testFireResult ?? {
        channel: "email",
        recipientCount: 1,
        usedDefault: true,
        missingVariables: [],
        errors: [],
      },
  );
  const automation: AutomationPublicApiRows = {
    findById: async ({ triggerId, projectId }) => {
      const row = rows.get(triggerId);
      return row && row.projectId === projectId ? row : null;
    },
    softDeleteById: async ({ triggerId }) => {
      const row = rows.get(triggerId);
      if (!row) throw new Error(`no row ${triggerId}`);
      const deleted = { ...row, deleted: true, active: false };
      rows.set(triggerId, deleted);
      return deleted;
    },
    create: async (command) => {
      const row = created(command);
      rows.set(row.id, row);
      return row;
    },
    update: async (command) => {
      const row = rows.get(command.id);
      if (!row) throw new Error(`no row ${command.id}`);
      const next = updated(row, command);
      rows.set(next.id, next);
      return next;
    },
    invalidate: async () => {},
    syncReportSchedule: vi.fn(async () => {}),
    removeReportSchedule: vi.fn(async () => {}),
    validateTemplateDraft: () => {},
    testFire,
    customGraphExistsInProject: async ({ customGraphId }) =>
      (options.graphIds ?? []).includes(customGraphId),
  };
  const limits = { count: vi.fn(async () => ({ allowed: true, resetAt: 0 })) };
  const evaluatorIds = new Set(options.evaluatorIds ?? []);
  const findByEvaluator = vi.fn(
    async ({ evaluatorId }: { projectId: string; evaluatorId: string }) =>
      (options.monitorsByEvaluator?.[evaluatorId] ?? []).map((id) => ({ id, name: id })),
  );
  const findEvaluator = vi.fn(async ({ id }: { id: string; projectId: string }) =>
    evaluatorIds.has(id) ? [id] : [],
  );
  const service = AutomationPublicApiService.create({
    automation,
    rules: { getProjectIdentity: async () => ({ name: "Acme", slug: TEST_PROJECT.slug }) },
    providers: AutomationProviderRegistryService.create(sealWith(MARKING_CRYPTO)),
    slackConnections: AutomationSlackConnectionService.create({
      slack,
      projects: { getOrganizationId: async () => "organization_1" },
      triggers: sealWith(MARKING_CRYPTO),
    }),
    slackDestinations: SlackDestinationService.create({
      slack,
      triggers: sealWith(MARKING_CRYPTO),
    }),
    filterValidation: TriggerFilterValidationService.create({
      evaluators: {
        findById: async (input) => {
          const [id] = await findEvaluator(input);
          return id ? evaluatorStub(id) : undefined;
        },
      },
      monitors: { findByEvaluator },
    }),
    history: MemoryTriggerFireHistoryRepository.create(store),
    traceFilters: {
      assertCompiles: ({ query }) => {
        if (query.includes("(("))
          throw new Error("unbalanced parenthesis at column 3 in traces.attributes");
      },
    },
    limits,
    logger: new SilentLogger(),
  });
  const app: Partial<AutomationApi> = {
    listAutomations: async () =>
      [...rows.values()]
        .filter((row) => !row.deleted)
        .map((row) => ({ ...service.redactForRead(row), checks: [], customGraph: null })),
    getPublicTrigger: (input) => service.getRedactedById(input),
    deletePublicTrigger: (input) => service.deleteById(input),
    createPublicTrigger: (input) => service.create(input),
    updatePublicTrigger: (input) => service.update(input),
    setPublicTriggerActive: (input) => service.setActive(input),
    getFireHistory: (input) => service.getFireHistory(input),
    testFireStoredTrigger: (input) => service.testFire(input),
  };
  return {
    api: mountAutomationRest(app),
    service,
    rows,
    store,
    createdConnections,
    testFire,
    limits,
    findByEvaluator,
    syncReportSchedule: automation.syncReportSchedule,
    removeReportSchedule: automation.removeReportSchedule,
  };
}

/** An evaluator of the test project; the filter check reads only that one exists. */
function evaluatorStub(id: string): Evaluator {
  return {
    id,
    projectId: TEST_PROJECT.id,
    name: id,
    slug: null,
    type: "evaluator",
    config: null,
    workflowId: null,
    copiedFromEvaluatorId: null,
    archivedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

/** The one secret-bearing row per channel the read suites list. */
export const SECRET_ROWS = {
  slackLegacyWebhook: triggerRow({
    id: "trigger_slack",
    action: TriggerAction.SEND_SLACK_MESSAGE,
    actionParams: { slackDelivery: "webhook", slackWebhook: SECRETS.webhookUrl },
  }),
  webhook: triggerRow({
    id: "trigger_webhook",
    action: TriggerAction.SEND_WEBHOOK,
    actionParams: {
      url: "https://receiver.example.com/hook",
      method: "POST",
      bodyTemplate: null,
      headersEncrypted: MARKING_CRYPTO.encrypt(
        JSON.stringify({ Authorization: SECRETS.headerValue }),
      ),
      signingSecretEncrypted: MARKING_CRYPTO.encrypt(SECRETS.signingSecret),
    },
  }),
};

/** A `/api/triggers` answer, read as the wire schema says it is. */
export const readTrigger = async (response: Response) =>
  automationRestResponseSchema.parse(await response.json());
export const readTriggers = async (response: Response) =>
  z.array(automationRestResponseSchema).parse(await response.json());
export const readFirePage = async (response: Response) =>
  automationRestFirePageSchema.parse(await response.json());
