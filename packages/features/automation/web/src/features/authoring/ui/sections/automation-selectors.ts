import {
  cadenceIsSet,
  conditionsAreSet,
  configIsComplete,
  configurationSummary,
  notifyChannel,
  presetLabels,
  subjectIsSet,
} from "./draft-model";
import { useAutomationStore } from "./automation-store";

/**
 * Selectors. Each subscribes to the minimum slice it needs so a
 * `SET_NAME` doesn't re-render the test-fire history list, etc.
 * Components should consume *these*, not poke at the store directly.
 */

export const useDraft = () => useAutomationStore((s) => s.draft);
export const useSection = () => useAutomationStore((s) => s.section);
export const useTestHistory = () => useAutomationStore((s) => s.testHistory);

export const useConditionsSet = () => useAutomationStore((s) => conditionsAreSet(s.draft));
export const useSubjectSet = () => useAutomationStore((s) => subjectIsSet(s.draft));
export const useCadenceSet = () => useAutomationStore((s) => cadenceIsSet(s.draft));
/** Preset noun set (heading / button / toast copy) for the chosen type.
 *  `isEdit` is a caller concern, so it stays an argument rather than store
 *  state; the hook only subscribes to `draft.source`. */
export const usePresetLabels = (isEdit: boolean) => {
  const source = useAutomationStore((s) => s.draft.source);
  return presetLabels(source, isEdit);
};
export const useConfigComplete = () => useAutomationStore((s) => configIsComplete(s.draft));
export const useConfigurationSummary = () =>
  useAutomationStore((s) => configurationSummary(s.draft));
export const useNotifyChannel = () => useAutomationStore((s) => notifyChannel(s.draft));
