/** Narrow, transport-neutral input for a persist-ceiling containment action. */
export type AutomationRunawayTrigger = {
  id: string;
  name: string;
  triggerKind: string;
  customGraphId: string | null;
  filterQuery: string | null;
  filters: Record<string, unknown>;
};

export type AutomationPersistCapBreach = {
  trigger: AutomationRunawayTrigger;
  projectId: string;
  count: number;
  cap: number;
  skipped: number;
};
