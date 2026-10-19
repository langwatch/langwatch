import { useCallback, useEffect, useRef, useState } from "react";

import { EMPTY_VOICE_FORM, formFromAgent, type VoiceForm } from "../model/voice-form.ts";
import { readVoiceDraft, writeVoiceDraft } from "./voice-draft-store.ts";

type SavedAgent = { name?: string | null; config?: unknown };

/** The saved agent when editing, the draft when creating, else nothing yet. */
function initialForm({
  agent,
  isCreating,
  isOpen,
  projectId,
}: {
  agent: SavedAgent | null | undefined;
  isCreating: boolean;
  isOpen: boolean;
  projectId: string;
}): VoiceForm | undefined {
  if (agent) return formFromAgent(agent);
  if (isCreating && isOpen && projectId) return readVoiceDraft(projectId);
  return void 0;
}

/** Form fields, seeded once per drawer session and persisted as a draft while creating. */
export function useVoiceFormState(input: {
  agent: SavedAgent | null | undefined;
  agentId: string | undefined;
  isCreating: boolean;
  isOpen: boolean;
  projectId: string;
}) {
  const { agent, agentId, isCreating, isOpen, projectId } = input;
  const [form, setForm] = useState<VoiceForm>(EMPTY_VOICE_FORM);
  const seededFor = useRef<string | undefined>(void 0);
  const identity = agentId ?? "new";

  useEffect(() => {
    if (!isOpen) {
      seededFor.current = void 0;
      return;
    }
    if (seededFor.current === identity) return;
    const seeded = initialForm({ agent, isCreating, isOpen, projectId });
    if (!seeded) return;
    setForm(seeded);
    seededFor.current = identity;
  }, [agent, identity, isCreating, isOpen, projectId]);

  useEffect(() => {
    if (!isCreating || !isOpen || !projectId || seededFor.current !== identity) return;
    writeVoiceDraft(projectId, form);
  }, [form, identity, isCreating, isOpen, projectId]);

  const change = useCallback((values: Partial<VoiceForm>) => {
    setForm((previous) => ({ ...previous, ...values }));
  }, []);

  return { form, change };
}
