/** An Evaluator an automation condition named, and the monitors running it. */
export interface EvaluatorReference {
  evaluatorId: string;
  monitorIds: string[];
}

/**
 * Automations-owned lookup against the Evaluator table, for one purpose: an
 * evaluation condition keyed by an Evaluator's id instead of a monitor's is
 * refused at the save, naming the monitors to key by. Project-scoped.
 */
export interface EvaluatorReferenceRepository {
  findAllByIds(params: {
    projectId: string;
    ids: string[];
  }): Promise<EvaluatorReference[]>;
}
