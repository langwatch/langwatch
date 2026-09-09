/**
 * Resolving the voice-call the run dialog's "Call it myself" action opens.
 *
 * A pure module so the detection — voice target alone, transport from the
 * agent's config, scenario id only when the dialog runs one scenario — is
 * unit-tested without mounting the dialog or pulling the call panel's transport
 * clients into the test.
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
  return {
    transport: parsed.data.transport,
    agentId: parsed.data.agentId,
    agentRowId: agent.id,
    // A call is scored against a scenario only when the dialog runs exactly
    // one; every other scope has no single scenario to write the run under.
    ...(subject.kind === "case" ? { scenarioId: subject.scenarioId } : {}),
  };
}
