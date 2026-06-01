import { useShallow } from "zustand/react/shallow";
import { CLIENT_PROVIDERS } from "~/automations/providers/client";
import { isNotifyEntry, type NotifyClientEntry } from "~/automations/providers/types";
import {
  cadenceSummary,
  conditionsAreSet,
  configIsComplete,
  configurationSummary,
  isNotifyAction,
  notifyChannel,
  summariseConditions,
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
export const useConfigComplete = () =>
  useAutomationStore((s) => configIsComplete(s.draft));
export const useSummariseConditions = () =>
  useAutomationStore((s) => summariseConditions(s.draft));
export const useConfigurationSummary = () =>
  useAutomationStore((s) => configurationSummary(s.draft));
export const useCadenceSummary = () =>
  useAutomationStore((s) => cadenceSummary(s.draft));
export const useNotifyChannel = () =>
  useAutomationStore((s) => notifyChannel(s.draft));
export const useIsNotifyAction = () =>
  useAutomationStore((s) => isNotifyAction(s.draft));

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
