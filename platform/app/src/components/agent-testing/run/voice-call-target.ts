/**
 * Resolving the voice-call the run dialog's "Call it myself" action opens.
 *
 * A pure module so the detection — voice target alone, transport from the
 * agent's config, scenario id only when exactly one scenario is in scope — is
 * unit-tested without mounting the dialog or pulling the call panel's transport
 * clients into the test.
 *
 * A voice call is offered only when exactly one scenario is in scope: a single
 * case, or a suite holding exactly one scenario. A `plan` subject (many
 * scenarios) has no single scenario to score the call under, so the resolved
 * target carries no `scenarioId` and the dialog gates the action off (#8019
 * AC9) — it is not an unscored voice-call target.
 *
 * @see specs/features/agents/voice-agents-v1.feature
 */

import {
  type VoiceTransport,
  voiceAgentConfigSchema,
} from "~/server/agents/voice/voice-agent.config";
import type { RunDialogSubject } from "./run-dialog-types";
import type { RunDialogForm } from "./useRunDialogForm";

/** The voice-call the panel opens on, or null when the target is not one. */
export type VoiceCallTarget = {
  transport: VoiceTransport;
  /** The transport's own agent id from the saved agent config. */
  agentId: string;
  /** The saved agent row id. */
  agentRowId: string;
  /** The scenario the call is scored under, when the dialog runs one scenario. */
  scenarioId?: string;
};

/**
 * The voice-call the "Call it myself" action opens, resolved from the selected
 * target. Null unless the target is a saved voice agent whose config names a
 * transport and an agent id, so the action is offered for voice targets alone
 * and never for HTTP, Code, Workflow or prompt targets (AC25).
 */
export function voiceCallTargetOf({
  form,
  subject,
}: {
  form: Pick<RunDialogForm, "target" | "scenarioAgents">;
  subject: RunDialogSubject;
}): VoiceCallTarget | null {
  const target = form.target;
  if (target?.type !== "voice") return null;
  const agent = form.scenarioAgents.find(
    (candidate) => candidate.id === target.id,
  );
  if (!agent) return null;
  const parsed = voiceAgentConfigSchema.safeParse(agent.config);
  if (!parsed.success) return null;
  // A call is scored against a scenario only when exactly one scenario is in
  // scope: a single case, or a suite that holds exactly one scenario. Every
  // other scope has no single scenario to write the run under.
  const scenarioId = scenarioIdInScope(subject);
  return {
    transport: parsed.data.transport,
    agentId: parsed.data.agentId,
    agentRowId: agent.id,
    ...(scenarioId ? { scenarioId } : {}),
  };
}

/** The one scenario a run covers, or undefined when the scope is not a single
 *  scenario: a case names its own; a suite with exactly one scenario names it. */
function scenarioIdInScope(subject: RunDialogSubject): string | undefined {
  if (subject.kind === "case") return subject.scenarioId;
  if (subject.kind === "suite" && subject.scenarioIds.length === 1) {
    return subject.scenarioIds[0];
  }
  return undefined;
}
