import {
  ModelProviderService,
  type ModelCostEstimateInput,
} from "@langwatch/model-provider-contract";

export class TestModelProviderService extends ModelProviderService {
  readonly costInputs: ModelCostEstimateInput[] = [];

  constructor(private readonly cost = 0) {
    super();
  }

  estimateCost(input: ModelCostEstimateInput): number {
    this.costInputs.push(input);
    return this.cost;
  }

  listForProject(): Promise<[]> {
    return Promise.resolve([]);
  }

  listForOrganization(): Promise<[]> {
    return Promise.resolve([]);
  }

  getForProject(): Promise<Record<string, never>> {
    return Promise.resolve({});
  }

  tryGetProviderForProject(): Promise<null> {
    return Promise.resolve(null);
  }

  tryFindRowServingModel(): Promise<null> {
    return Promise.resolve(null);
  }

  getExecutionProviders(): Promise<Record<string, never>> {
    return Promise.resolve({});
  }

  prepareExecution(): Promise<Record<string, string>> {
    return Promise.resolve({});
  }

  upsert(): Promise<never> {
    throw new Error("Not used by Trace tests.");
  }

  delete(): Promise<void> {
    return Promise.resolve();
  }

  validateApiKey(): Promise<never> {
    throw new Error("Not used by Trace tests.");
  }

  testConnection(): Promise<{ connected: boolean }> {
    return Promise.resolve({ connected: false });
  }

  getCodexStatus(): Promise<never> {
    throw new Error("Not used by Trace tests.");
  }

  refreshCodexForGateway(): Promise<never> {
    throw new Error("Not used by Trace tests.");
  }

  isManagedProvider(): boolean {
    return false;
  }

  getDefaultSnapshot(): Promise<never> {
    throw new Error("Not used by Trace tests.");
  }

  getInheritedValues(): Promise<never> {
    throw new Error("Not used by Trace tests.");
  }

  tryGetResolvedDefault(): Promise<null> {
    return Promise.resolve(null);
  }

  resolveModelForFeature(): Promise<never> {
    throw new Error("Not used by Trace tests.");
  }

  tryFindAlternateModel(): Promise<never> {
    throw new Error("Not used by Trace tests.");
  }

  setDefault(): Promise<void> {
    return Promise.resolve();
  }

  saveDefaultConfig(): Promise<never> {
    throw new Error("Not used by Trace tests.");
  }

  tryGetDefaultConfig(): Promise<null> {
    return Promise.resolve(null);
  }

  deleteDefaultConfig(): Promise<void> {
    return Promise.resolve();
  }

  listCosts(): Promise<[]> {
    return Promise.resolve([]);
  }

  upsertCost(): Promise<never> {
    throw new Error("Not used by Trace tests.");
  }

  deleteCost(): Promise<void> {
    return Promise.resolve();
  }

  translate(): Promise<never> {
    throw new Error("Not used by Trace tests.");
  }
}
