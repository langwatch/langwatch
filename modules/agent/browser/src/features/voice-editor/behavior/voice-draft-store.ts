/** The per-tab create draft; storage that refuses reads as "nothing remembered". */

import {
  formFromDraft,
  parseVoiceDraft,
  serializeVoiceDraft,
  voiceDraftKey,
} from "../model/voice-draft.ts";
import type { VoiceForm } from "../model/voice-form.ts";

export function readVoiceDraft(projectId: string): VoiceForm {
  try {
    return formFromDraft(
      parseVoiceDraft(globalThis.sessionStorage?.getItem(voiceDraftKey(projectId))),
    );
  } catch {
    return formFromDraft(void 0);
  }
}

export function writeVoiceDraft(projectId: string, form: VoiceForm): void {
  try {
    globalThis.sessionStorage?.setItem(voiceDraftKey(projectId), serializeVoiceDraft(form));
  } catch {
    return;
  }
}

export function clearVoiceDraft(projectId: string): void {
  try {
    globalThis.sessionStorage?.removeItem(voiceDraftKey(projectId));
  } catch {
    return;
  }
}
