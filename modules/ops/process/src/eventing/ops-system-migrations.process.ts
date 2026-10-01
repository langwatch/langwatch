import type { EventHandler, IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

/** Main's re-drive cadence: a tenant whose blocker was fixed heals within the hour. */
export const SYSTEM_MIGRATION_REDRIVE_INTERVAL_MS = 60 * 60_000;

export const systemMigrationPassIntentSchema = z.object({
  /** A re-drive runs only when a tenant could still move; an operator's kick always runs. */
  redrive: z.boolean(),
  requestedAt: z.number().int(),
});

export const systemMigrationPassStateSchema = z.object({
  lastRequestedAt: z.number().nullable(),
});
export type SystemMigrationPassState = z.infer<typeof systemMigrationPassStateSchema>;

export const SYSTEM_MIGRATION_PASS_INITIAL_STATE: SystemMigrationPassState = {
  lastRequestedAt: null,
};

export type SystemMigrationPassIntents = {
  runPass: IntentSpec<typeof systemMigrationPassIntentSchema>;
};

/** Keyed by the wake, so a redelivered wake asks for its pass once. */
export const systemMigrationRedriveWake: WakeHandler<
  SystemMigrationPassState,
  SystemMigrationPassIntents
> = (_state, ctx) => ({
  state: { lastRequestedAt: ctx.at },
  intents: [ctx.intent("runPass", `redrive:${ctx.at}`, { redrive: true, requestedAt: ctx.at })],
});

/** Keyed by the request, so a redelivered event asks for its pass once. */
export const systemMigrationPassRequested: EventHandler<
  SystemMigrationPassState,
  Record<string, never>,
  SystemMigrationPassIntents
> = (_state, _data, ctx) => ({
  state: { lastRequestedAt: ctx.at },
  intents: [
    ctx.intent("runPass", `operator:${ctx.projectId}:${ctx.at}`, {
      redrive: false,
      requestedAt: ctx.at,
    }),
  ],
});
