import { z } from "zod";
import { makeRequest } from "./langwatch-api.js";
import {
  deletedTriggerSchema,
  type GraphAlertRule,
  type NotificationCadence,
  type TestFireResult,
  type Trigger,
  type TriggerAction,
  type TriggerActionParams,
  type TriggerAlertType,
  type TriggerFire,
  type TriggerTemplates,
  testFireResultSchema,
  triggerFireSchema,
  triggerSchema,
} from "./schemas/triggers.js";

/**
 * The `/api/triggers` calls, each answering with the shape `schemas/triggers`
 * declares. Responses are read through that schema rather than cast to it, so
 * a deployment that stops sending something a tool renders is a loud failure
 * rather than an `undefined` in the middle of a message to an agent.
 */

export interface CreateTriggerInput {
  name: string;
  action: TriggerAction;
  actionParams: TriggerActionParams;
  filters?: Record<string, unknown>;
  filterQuery?: string | null;
  message?: string;
  alertType?: TriggerAlertType;
  customGraphId?: string;
  graphAlert?: GraphAlertRule;
  templates?: TriggerTemplates;
  notificationCadence?: NotificationCadence;
}

export interface UpdateTriggerInput {
  id: string;
  name?: string;
  active?: boolean;
  message?: string | null;
  alertType?: TriggerAlertType | null;
  filters?: Record<string, unknown>;
  filterQuery?: string | null;
  /** Replaces the delivery configuration as a whole. A credential sent back as
   *  `[redacted]` keeps the stored one. The channel itself cannot change. */
  actionParams?: TriggerActionParams;
  graphAlert?: GraphAlertRule;
  templates?: TriggerTemplates;
  notificationCadence?: NotificationCadence;
}

export async function listTriggers(): Promise<Trigger[]> {
  return z
    .array(triggerSchema)
    .parse(await makeRequest("GET", "/api/triggers"));
}

export async function getTrigger(id: string): Promise<Trigger> {
  return triggerSchema.parse(
    await makeRequest("GET", `/api/triggers/${encodeURIComponent(id)}`),
  );
}

export async function createTrigger(
  input: CreateTriggerInput,
): Promise<Trigger> {
  return triggerSchema.parse(await makeRequest("POST", "/api/triggers", input));
}

export async function updateTrigger({
  id,
  ...data
}: UpdateTriggerInput): Promise<Trigger> {
  return triggerSchema.parse(
    await makeRequest("PATCH", `/api/triggers/${encodeURIComponent(id)}`, data),
  );
}

/** Resume or pause an automation. A report's schedule follows: pausing retires
 *  its calendar entry and resuming puts it back. */
export async function setTriggerActive({
  id,
  active,
}: {
  id: string;
  active: boolean;
}): Promise<Trigger> {
  return triggerSchema.parse(
    await makeRequest(
      "POST",
      `/api/triggers/${encodeURIComponent(id)}/${active ? "enable" : "disable"}`,
    ),
  );
}

/** Send the automation's message to the destination it is saved with. */
export async function testFireTrigger(id: string): Promise<TestFireResult> {
  return testFireResultSchema.parse(
    await makeRequest(
      "POST",
      `/api/triggers/${encodeURIComponent(id)}/test-fire`,
    ),
  );
}

/** What the automation has done, newest first. Metadata only. */
export async function listTriggerFires({
  id,
  limit,
}: {
  id: string;
  limit?: number;
}): Promise<TriggerFire[]> {
  const query = limit === undefined ? "" : `?limit=${limit}`;
  return z
    .array(triggerFireSchema)
    .parse(
      await makeRequest(
        "GET",
        `/api/triggers/${encodeURIComponent(id)}/fires${query}`,
      ),
    );
}

export async function deleteTrigger(
  id: string,
): Promise<z.infer<typeof deletedTriggerSchema>> {
  return deletedTriggerSchema.parse(
    await makeRequest("DELETE", `/api/triggers/${encodeURIComponent(id)}`),
  );
}
