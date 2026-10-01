/** Automation's procedures, derived from its contract: the checklist asks automation (§9). */
import { type ContractApiMap, createModuleApi, type ModuleApi } from "@langwatch/api/web";
import type { automationTrpc } from "@langwatch/automation-contract";

export type AutomationApiMap = ContractApiMap<typeof automationTrpc>;

export const automationApi: ModuleApi<AutomationApiMap> = createModuleApi<AutomationApiMap>();
