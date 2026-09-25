import type { AutomationClock,AutomationProjectDirectory } from "../app/automation.members.ts";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import {
  AutomationDispatchError,
  AutomationLogger,
} from "../services/automation-graph-runtime.service.ts";
import { AutomationNotificationDelivery } from "../channels/automation-notification-delivery.channel.ts";
import { type Instant, Temporal, toDate } from "@langwatch/time";

// Strict Prisma double for graph-alert vertical; fails on queries it should not
// need.

export type TriggerRow = Record<string, unknown>;

export const FROZEN_NOW = Temporal.Instant.from("2026-09-02T12:00:00.000Z");

/** The same moment as a stored column hands it back, for the row doubles. */
const FROZEN_ROW_AT = toDate(FROZEN_NOW);

export class FrozenClock implements AutomationClock {
  now(): Instant {
    return FROZEN_NOW;
  }
}

export class SilentLogger extends AutomationLogger {
  readonly errors: [Record<string, unknown>, string][] = [];

  error(fields: Record<string, unknown>, message: string): void {
    this.errors.push([fields, message]);
  }
  debug(): void {}
  info(): void {}
  warn(): void {}
}

export class TestDispatchErrors extends AutomationDispatchError {
  isTerminal(): boolean {
    return false;
  }
  createTerminal(message: string): unknown {
    return new Error(message);
  }
}

/** Records what would have left the process, and never a token or a body. */
export class RecordingDelivery extends AutomationNotificationDelivery {
  readonly emails: { recipients: string[]; subject: string; triggerId: string }[] = [];
  readonly slackWebhooks: { webhook: string; triggerName: string }[] = [];
  readonly slackBots: { channel: string; triggerName: string }[] = [];
  readonly webhooks: string[] = [];

  async sendLegacyEmail(): Promise<void> {
    throw new Error("The graph path does not send legacy digests.");
  }

  async sendEmail(input: {
    recipients: string[];
    triggerId: string;
    projectId: string;
    subject: string;
    html: string;
    isRecipientSent(recipientHash: string): Promise<boolean>;
    recordRecipientSent(recipientHash: string): Promise<void>;
  }): Promise<void> {
    for (const recipient of input.recipients) {
      if (await input.isRecipientSent(recipient)) continue;
      this.emails.push({
        recipients: [recipient],
        subject: input.subject,
        triggerId: input.triggerId,
      });
      await input.recordRecipientSent(recipient);
    }
  }

  async sendSlackWebhook(input: { webhook: string; triggerName: string }): Promise<void> {
    this.slackWebhooks.push(input);
  }

  async sendLegacySlackWebhook(): Promise<void> {
    throw new Error("The graph path does not send legacy Slack digests.");
  }

  async sendSlackBot(input: { channel: string; triggerName: string }): Promise<void> {
    this.slackBots.push({ channel: input.channel, triggerName: input.triggerName });
  }

  async sendWebhook(input: {
    url: string;
    eventId: string;
  }): Promise<{ status: number; body: string; eventId: string }> {
    this.webhooks.push(input.url);
    return { status: 200, body: "", eventId: input.eventId };
  }
}

export function graphTriggerRow(over: Partial<TriggerRow> = {}): TriggerRow {
  return {
    id: "trigger-1",
    projectId: "project-1",
    name: "Error rate",
    action: "SEND_EMAIL",
    triggerKind: "ALERT",
    actionParams: {
      members: ["ada@example.com"],
      threshold: 10,
      operator: "gt",
      timePeriod: 60,
      seriesName: "0",
    },
    filters: {},
    filterQuery: null,
    active: true,
    deleted: false,
    pausedReason: null,
    pausedAt: null,
    message: null,
    alertType: null,
    customGraphId: "graph-1",
    notificationCadence: "immediate",
    traceDebounceMs: 0,
    slackTemplateType: null,
    slackTemplate: null,
    emailSubjectTemplate: null,
    emailBodyTemplate: null,
    createdAt: FROZEN_ROW_AT,
    updatedAt: FROZEN_ROW_AT,
    lastRunAt: null,
    ...over,
  };
}

export const customGraphRow = {
  id: "graph-1",
  projectId: "project-1",
  name: "Errors per minute",
  kind: "builder",
  filters: {},
  graph: {
    series: [{ name: "Errors", metric: "metadata.trace_id", aggregation: "cardinality" }],
    timeScale: 60,
  },
};

/** One recorded timeseries answer, above any threshold the fixtures set. */
export class BreachingAnalytics {
  calls = 0;

  async getTimeseries(): Promise<unknown> {
    this.calls += 1;
    return {
      previousPeriod: [],
      currentPeriod: [
        { date: "2026-09-02", "0/metadata.trace_id/cardinality": 42 },
        { date: "2026-09-02", "0/metadata.trace_id/cardinality": 43 },
      ],
    };
  }
}

export class OneProject implements AutomationProjectDirectory {
  async findById(
    projectId: string,
  ): Promise<{ id: string; name: string; slug: string } | null> {
    return { id: projectId, name: "Acme", slug: "acme" };
  }
}

type PrismaDoubleSeed = {
  triggers: TriggerRow[];
  customGraphs?: Record<string, unknown>[];
  suppressions?: { projectId: string; triggerId: string | null; email: string }[];
};

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") {
      return (value as Record<string, unknown>[]).some((clause) => matches(row, clause));
    }
    if (key === "id" && typeof value === "string") return row.id === value;
    return row[key] === value;
  });
}

function isSameTraceSent(row: Record<string, unknown>, entry: Record<string, unknown>): boolean {
  return (
    row.triggerId === entry.triggerId &&
    row.projectId === entry.projectId &&
    row.traceId === entry.traceId
  );
}

/**
 * The tables this path reads and writes, held in arrays. Filtering is
 * deliberately literal -- enumerated `where` shapes, not a generic
 * interpreter, so a drifted repository stops matching instead of reading everything.
 */
type GraphActivityPrismaDouble = {
  prisma: ReturnType<typeof prismaDouble>;
  reads: { triggerFindMany: number };
  triggerSent: Record<string, unknown>[];
  triggers: PrismaDoubleSeed["triggers"];
};

export function createGraphActivityPrismaDouble(seed: PrismaDoubleSeed): GraphActivityPrismaDouble {
  const triggers = seed.triggers.map((row) => ({ ...row }));
  const customGraphs = (seed.customGraphs ?? [customGraphRow]).map((row) => ({ ...row }));
  const suppressions = (seed.suppressions ?? []).map((row) => ({ ...row }));
  const triggerSent: Record<string, unknown>[] = [];
  const reads = { triggerFindMany: 0 };
  let nextId = 1;

  const prisma = {
    trigger: {
      findMany: async ({ where = {} }: { where?: Record<string, unknown> } = {}) => {
        reads.triggerFindMany += 1;
        return triggers.filter((row) => matches(row, where));
      },
      findFirst: async ({ where = {} }: { where?: Record<string, unknown> } = {}) =>
        triggers.find((row) => matches(row, where)) ?? null,
      update: async ({
        where = {},
        data,
      }: {
        where?: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const row = triggers.find((entry) => matches(entry, where));
        if (!row) throw new Error("trigger not found");
        Object.assign(row, data);
        return row;
      },
    },
    customGraph: {
      findUnique: async ({ where = {} }: { where?: Record<string, unknown> } = {}) =>
        customGraphs.find((row) => matches(row, where)) ?? null,
    },
    emailSuppression: {
      findMany: async ({ where = {} }: { where?: Record<string, unknown> } = {}) =>
        suppressions
          .filter((row) => matches(row, where))
          .map((row) => ({ ...row, id: "suppression", reason: "unsubscribed", createdAt: FROZEN_ROW_AT })),
    },
    triggerSent: {
      findFirst: async ({ where = {} }: { where?: Record<string, unknown> } = {}) =>
        triggerSent.find((row) => matches(row, where)) ?? null,
      findMany: async ({ where = {} }: { where?: Record<string, unknown> } = {}) =>
        triggerSent.filter((row) => matches(row, where)),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `sent-${nextId++}`, createdAt: FROZEN_ROW_AT, ...data };
        triggerSent.push(row);
        return row;
      },
      createMany: async (args?: { data: Record<string, unknown> | Record<string, unknown>[] }) => {
        let count = 0;
        for (const entry of [args?.data ?? []].flat()) {
          const duplicate = triggerSent.some((row) => isSameTraceSent(row, entry));
          if (duplicate) continue;
          triggerSent.push({ id: `sent-${nextId++}`, createdAt: FROZEN_ROW_AT, ...entry });
          count += 1;
        }
        return { count };
      },
      update: async ({
        where = {},
        data,
      }: {
        where?: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const row = triggerSent.find((entry) => matches(entry, where));
        if (!row) throw new Error("triggerSent not found");
        Object.assign(row, data);
        return row;
      },
      delete: async ({ where = {} }: { where?: Record<string, unknown> } = {}) => {
        const index = triggerSent.findIndex((entry) => matches(entry, where));
        if (index >= 0) triggerSent.splice(index, 1);
        return {};
      },
    },
  };

  return { prisma: prismaDouble(prisma), reads, triggerSent, triggers };
}
