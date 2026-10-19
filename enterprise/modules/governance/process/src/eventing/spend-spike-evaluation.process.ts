// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

export const SPEND_SPIKE_EVALUATION_PROCESS_NAME = "spendSpikeEvaluation";

/** Main's `spendSpikeAnomalyWorker` tick: every active spend_spike rule, every five minutes. */
export const SPEND_SPIKE_EVALUATION_INTERVAL_MS = 5 * 60 * 1000;

export const spendSpikeEvaluationPassSchema = z.object({ scheduledFor: z.number().int() });

export const spendSpikeEvaluationStateSchema = z.object({
  /** Epoch ms of the last pass this process asked for. */
  lastPassAt: z.number().nullable(),
});
type SpendSpikeEvaluationState = z.infer<typeof spendSpikeEvaluationStateSchema>;

export const SPEND_SPIKE_EVALUATION_INITIAL_STATE: SpendSpikeEvaluationState = {
  lastPassAt: null,
};

type SpendSpikeEvaluationIntents = {
  pass: IntentSpec<typeof spendSpikeEvaluationPassSchema>;
};

/** Every wake asks for one pass. Pure; the pass itself runs behind the outbox lease. */
export const spendSpikeEvaluationWake: WakeHandler<
  SpendSpikeEvaluationState,
  SpendSpikeEvaluationIntents
> = (_state, ctx) => ({
  state: { lastPassAt: ctx.at },
  intents: [ctx.intent("pass", `pass:${ctx.at}`, { scheduledFor: ctx.at })],
});
