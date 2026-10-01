import { z } from "zod";
import { makeRequest } from "./langwatch-api.ts";
import {
  deletedTriggerSchema,
  type GraphAlertRule,
  type NotificationCadence,
  type ReportRule,
  type TestFireResult,
  type Trigger,
  type TriggerAction,
  type TriggerActionParams,
  type TriggerAlertType,
  type TriggerFirePage,
  type TriggerTemplates,
  testFireResultSchema,
  triggerFirePageSchema,
  triggerSchema,
} from "./schemas/triggers.ts";

/**
 * The `/api/v1/triggers` calls, each answering with the shape `schemas/triggers`
 * declares. Responses are read through that schema rather than cast to it, so
 * a deployment that stops sending something a tool renders is a loud failure
 * rather than an `undefined` in the middle of a message to an agent.
 */

export interface CreateTriggerInput {
  name: string;
  action: TriggerAction;
  /** Omitted sends `{}`, as before `actionParams` was stated per channel. */
  actionParams?: TriggerActionParams;
  filters?: Record<string, unknown>;
  filterQuery?: string | null;
  message?: string;
  alertType?: TriggerAlertType;
  customGraphId?: string;
  graphAlert?: GraphAlertRule;
  report?: ReportRule;
  templates?: TriggerTemplates;
  notificationCadence?: NotificationCadence;
}

/** `actionParams` replaces the delivery configuration as a whole; a credential
 *  sent back as `[redacted]` keeps the stored one. The channel cannot change. */
type UpdateTriggerInput = Partial<
  Omit<CreateTriggerInput, "action" | "customGraphId" | "message" | "alertType">
> & {
  id: string;
  active?: boolean;
  message?: string | null;
  alertType?: TriggerAlertType | null;
};

export async function listTriggers(): Promise<Trigger[]> {
  return z
    .array(triggerSchema)
    .parse(await makeRequest("GET", "/api/v1/triggers"));
}

export async function getTrigger(id: string): Promise<Trigger> {
  return triggerSchema.parse(
    await makeRequest("GET", `/api/v1/triggers/${encodeURIComponent(id)}`),
  );
}

export async function createTrigger(
  input: CreateTriggerInput,
): Promise<Trigger> {
  return triggerSchema.parse(
    await makeRequest("POST", "/api/v1/triggers", {
      ...input,
      actionParams: input.actionParams ?? {},
    }),
  );
}

export async function updateTrigger({
  id,
  ...data
}: UpdateTriggerInput): Promise<Trigger> {
  return triggerSchema.parse(
    await makeRequest("PATCH", `/api/v1/triggers/${encodeURIComponent(id)}`, data),
  );
}

/** Send the automation's message to the destination it is saved with. */
export async function testFireTrigger(id: string): Promise<TestFireResult> {
  return testFireResultSchema.parse(
    await makeRequest(
      "POST",
      `/api/v1/triggers/${encodeURIComponent(id)}/test-fire`,
    ),
  );
}

/** What the automation has done, newest first. Metadata only. `cursor` reads
 *  the page after the one that answered with it as `nextCursor`. */
export async function listTriggerFires({
  id,
  limit,
  cursor,
}: {
  id: string;
  limit?: number;
  cursor?: string;
}): Promise<TriggerFirePage> {
  const query = new URLSearchParams();
  if (limit !== undefined) query.set("limit", String(limit));
  if (cursor) query.set("cursor", cursor);
  const search = query.toString() ? `?${query.toString()}` : "";
  return triggerFirePageSchema.parse(
    await makeRequest(
      "GET",
      `/api/v1/triggers/${encodeURIComponent(id)}/fires${search}`,
    ),
  );
}

export async function deleteTrigger(
  id: string,
): Promise<z.infer<typeof deletedTriggerSchema>> {
  return deletedTriggerSchema.parse(
    await makeRequest("DELETE", `/api/v1/triggers/${encodeURIComponent(id)}`),
  );
}
