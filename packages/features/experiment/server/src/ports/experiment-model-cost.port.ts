/**
 * What a cell's tokens cost, in the deployment's own rate table.
 *
 * The rates live with the tracer's cost catalogue, which is neither the
 * Experiment feature's data nor portable: a self-hosted deployment prices the
 * same model differently from the cloud one. The run asks for a number and
 * takes `undefined` for "no known rate", which is what it already did.
 */
export abstract class ExperimentModelCostPort {
  abstract tryPriceTokens(input: {
    projectId: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
  }): Promise<number | undefined>;
}
