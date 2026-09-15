/**
 * Resolving the voice-call the run dialog's "Call it myself" action opens.
 * Offered only when exactly one scenario is in scope — a `plan` subject or
 * empty scope has none to score under, so the dialog gates the action off (#8019 AC9).
 * @see specs/features/agents/voice-agents-v1.feature
 */

import {
  type VoiceTransport,
  voiceAgentConfigSchema,
} from "@langwatch/scenario-contract";
import type { RunDialogSubject } from "./run-dialog-types";
import type { RunDialogForm } from "./use-run-dialog-form.ts";

/** The voice-call the panel opens on, or null when the target is not one. */
export type VoiceCallTarget = {
  transport: VoiceTransport;
  /** The transport's own agent id from the saved agent config. */
  agentId: string;
  /** The saved agent row id. */
  agentRowId: string;
  /** The scenario the call is scored under; a target is resolved only when
   *  exactly one scenario is in scope, so this is always present. */
  scenarioId: string;
};

/**
 * The voice-call the "Call it myself" action opens, resolved from the
 * selected target. Null unless it's a saved voice agent with a transport
 * and agent id, so it's offered only for voice targets, never others (AC25).
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
  // The browser call reaches an ElevenLabs agent only; a phone target has no
  // in-browser call, so no target is resolved for it (the drawer offers the
  // scenario run instead).
  if (parsed.data.transport !== "elevenlabs_convai") return null;
  // A call is scored against a scenario only when exactly one scenario is in
  // scope: a single case, or a suite that holds exactly one scenario. Every
  // other scope has no single scenario to write the run under, so no target is
  // offered (#8019 AC9).
  const scenarioId = scenarioIdInScope(subject);
  if (!scenarioId) return null;
  return {
    transport: parsed.data.transport,
    agentId: parsed.data.agentId,
    agentRowId: agent.id,
    scenarioId,
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
