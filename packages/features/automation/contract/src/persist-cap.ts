/** Process configuration for the confirmed-persist daily ceiling. */
export interface AutomationPersistCapConfig {
  free: number;
  paid: number;
  enterprise: number;
}

/** Provider-neutral plan data needed to select a persist ceiling. */
export interface AutomationPlan {
  type: string;
  free: boolean;
  maxTriggerPersistDispatchesPerDay?: number;
}

/** Complete plan capability supplied by billing composition. */
export interface AutomationPlanProvider {
  getActivePlan(input: { organizationId: string }): Promise<AutomationPlan>;
}

export interface AutomationPersistCapDecision {
  allowed: boolean;
  /** Confirmed dispatches counted for this trigger today, cap included. */
  count: number;
  cap: number;
  /** Confirmed matches dropped today. Zero until the cap is passed. */
  skipped: number;
}

export interface AutomationPersistCapCount {
  count: number;
  skipped: number;
}
