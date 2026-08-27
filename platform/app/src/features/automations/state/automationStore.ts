import {
  createAutomationAuthoringStore,
  MAX_AUTOMATION_TEST_HISTORY,
  type AutomationAuthoringStore,
  type AutomationTestFireAttempt,
} from "@langwatch/automation-web";
import type { AutomationProviderClients } from "../providers/registry";
import { AUTOMATION_DRAFT_MODEL } from "../providers/registry";

export const MAX_TEST_HISTORY = MAX_AUTOMATION_TEST_HISTORY;
export type TestFireAttempt = AutomationTestFireAttempt;
export type AutomationStore = AutomationAuthoringStore<AutomationProviderClients>;
export const useAutomationStore = createAutomationAuthoringStore(AUTOMATION_DRAFT_MODEL);
