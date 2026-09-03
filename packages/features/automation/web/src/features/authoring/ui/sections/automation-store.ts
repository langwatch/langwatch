import {
  createAutomationAuthoringStore,
  MAX_AUTOMATION_TEST_HISTORY,
  type AutomationAuthoringStore,
  type AutomationTestFireAttempt,
} from "../../behavior/automation-authoring-store";
import type { AutomationProviderClients } from "./client-providers";
import { AUTOMATION_DRAFT_MODEL } from "./client-providers";

export const MAX_TEST_HISTORY = MAX_AUTOMATION_TEST_HISTORY;
export type TestFireAttempt = AutomationTestFireAttempt;
export type AutomationStore = AutomationAuthoringStore<AutomationProviderClients>;
export const useAutomationStore = createAutomationAuthoringStore(AUTOMATION_DRAFT_MODEL);
