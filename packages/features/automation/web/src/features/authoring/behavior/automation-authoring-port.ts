import { createContext, useContext } from "react";
import type {
  AlertType,
  SavedTriggerRow,
  TriggerAction,
  TriggerKind,
} from "@langwatch/automation-contract";

/** A portable trace filter value. The host owns query parsing and transport. */
export type AutomationFilterValues = Record<string, unknown>;

export interface AutomationAuthoringTarget {
  projectId: string;
  organizationId: string;
}

export interface AutomationAuthoringNavigationPort {
  close(): void;
  openConfiguration(): void;
  openDataset(datasetId: string): void;
  isInAutomationFlow(): boolean;
}

export interface AutomationAuthoringDataPort {
  target(): AutomationAuthoringTarget;
  load(automationId: string): SavedTriggerRow | undefined;
  listDatasets(): ReadonlyArray<{ id: string; name: string }>;
}

export interface AutomationAuthoringActionPort {
  create(input: {
    name: string;
    action: TriggerAction;
    kind: TriggerKind;
    alertType: AlertType | null;
    filters: AutomationFilterValues;
  }): Promise<SavedTriggerRow>;
  update(input: {
    automationId: string;
    name: string;
    action: TriggerAction;
    kind: TriggerKind;
    alertType: AlertType | null;
    filters: AutomationFilterValues;
  }): Promise<SavedTriggerRow>;
  test(input: { automationId: string; action: TriggerAction }): Promise<void>;
}

/**
 * The only host boundary for automation authoring. Presentation code receives
 * automation data, named mutations, and navigation without importing tRPC,
 * Prisma, routing, or app-specific drawers.
 */
export interface AutomationAuthoringPort {
  readonly data: AutomationAuthoringDataPort;
  readonly actions: AutomationAuthoringActionPort;
  readonly navigation: AutomationAuthoringNavigationPort;
}

export const AutomationAuthoringPortContext = createContext<AutomationAuthoringPort | null>(null);

export function useAutomationAuthoringPort(): AutomationAuthoringPort {
  const port = useContext(AutomationAuthoringPortContext);
  if (!port) {
    throw new Error("AutomationAuthoringPortContext is required for automation authoring");
  }
  return port;
}
