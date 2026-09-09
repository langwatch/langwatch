/**
 * The setup checklist the onboarding screens render. Its tRPC namespace and the
 * rollup behind it went with the transport that took them; the two evidence
 * ports below stay, because other features fill them.
 */
/**
 * Whether this project has run any simulation, for the checklist's own step. The evidence
 * is a scenario-set read in ClickHouse and the scenario vertical is not composed here, so
 * the step arrives as a port.
 */
export abstract class ApiSimulationEvidencePort {
  abstract hasAnySimulation(input: { projectId: string }): Promise<boolean>;
}

/**
 * Whether this project has a model provider attached and switched on, for the checklist's
 * own step. A port rather than a `prisma.modelProvider` read written here, and the reason
 * is the column next to the one this needs.
 */
export abstract class ApiModelProviderEvidencePort {
  abstract hasEnabledProvider(input: { projectId: string }): Promise<boolean>;
}

/** The setup checklist, exactly as the onboarding screens read it. */
export type ApiOnboardingCheckStatus = Readonly<{
  workflows: number;
  customGraphs: number;
  datasets: number;
  onlineEvaluations: number;
  triggers: number;
  simulations: number;
  modelProviders: number;
  prompts: number;
  teamMembers: number;
  firstMessage: boolean;
  integrated: boolean;
}>;
