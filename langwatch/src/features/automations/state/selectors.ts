import { useShallow } from "zustand/react/shallow";
import { CLIENT_PROVIDERS } from "~/automations/providers/client";
import {
  isNotifyEntry,
  type NotifyClientEntry,
} from "~/automations/providers/types";
import {
  cadenceIsSet,
  conditionsAreSet,
  configIsComplete,
  configurationSummary,
  notifyChannel,
  presetLabels,
  subjectIsSet,
} from "../logic/draftReducer";
import { useAutomationStore } from "./automationStore";

/**
 * Selectors. Each subscribes to the minimum slice it needs so a
 * `SET_NAME` doesn't re-render the test-fire history list, etc.
 * Components should consume *these*, not poke at the store directly.
 */

export const useDraft = () => useAutomationStore((s) => s.draft);
export const useSection = () => useAutomationStore((s) => s.section);
export const useTestHistory = () => useAutomationStore((s) => s.testHistory);

export const useConditionsSet = () =>
  useAutomationStore((s) => conditionsAreSet(s.draft));
export const useSubjectSet = () =>
  useAutomationStore((s) => subjectIsSet(s.draft));
export const useCadenceSet = () =>
  useAutomationStore((s) => cadenceIsSet(s.draft));
/** Preset noun set (heading / button / toast copy) for the chosen type.
 *  `isEdit` is a caller concern, so it stays an argument rather than store
 *  state; the hook only subscribes to `draft.source`. */
export const usePresetLabels = (isEdit: boolean) => {
  const source = useAutomationStore((s) => s.draft.source);
  return presetLabels(source, isEdit);
};
export const useConfigComplete = () =>
  useAutomationStore((s) => configIsComplete(s.draft));
export const useConfigurationSummary = () =>
  useAutomationStore((s) => configurationSummary(s.draft));
export const useNotifyChannel = () =>
  useAutomationStore((s) => notifyChannel(s.draft));

/**
 * Resolves the active notify provider + its slice, or null when the
 * active action is not a notify provider. Used by the test-fire section
 * and the preview pane gating.
 */
export interface NotifyContext {
  provider: NotifyClientEntry;
  slice: unknown;
}
export const useNotifyContext = (): NotifyContext | null =>
  useAutomationStore(
    useShallow((s): NotifyContext | null => {
      if (!s.draft.action) return null;
      const entry = CLIENT_PROVIDERS[s.draft.action];
      if (!isNotifyEntry(entry)) return null;
      return { provider: entry, slice: s.draft.slices[s.draft.action] };
    }),
  );

/**
 * Resolves the active provider entry + its slice for the configuration
 * secondary drawer to render. Returns null when no type is chosen yet.
 */
export const useActiveProvider = () =>
  useAutomationStore(
    useShallow((s) => {
      if (!s.draft.action) return null;
      const entry = CLIENT_PROVIDERS[s.draft.action];
      return { provider: entry, slice: s.draft.slices[s.draft.action] };
    }),
  );
