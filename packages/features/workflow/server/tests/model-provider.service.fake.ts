import {
  ModelProviderService,
  type ModelProviderSummary,
} from "@langwatch/model-provider-contract";

export class TestModelProviderService extends ModelProviderService {
  constructor(private readonly providers: Record<string, ModelProviderSummary> = {}) {
    super();
  }

  listForProject(): Promise<ModelProviderSummary[]> {
    return Promise.resolve(Object.values(this.providers));
  }

  listForOrganization(): Promise<ModelProviderSummary[]> {
    return Promise.resolve(Object.values(this.providers));
  }

  getForProject(): Promise<Record<string, ModelProviderSummary>> {
    return Promise.resolve(this.providers);
  }

  getExecutionProviders(): Promise<Record<string, never>> {
    return Promise.resolve({});
  }

  prepareExecution(): Promise<Record<string, string>> {
    return Promise.resolve({});
  }

  tryGetProviderForProject(): Promise<null> {
    return Promise.resolve(null);
  }

  tryFindRowServingModel(): Promise<null> {
    return Promise.resolve(null);
  }

  tryGetResolvedDefault(): Promise<null> {
    return Promise.resolve(null);
  }

  resolveModelForFeature(): Promise<never> {
    throw new Error("Not used by Workflow tests.");
  }

  findAlternateModel(): Promise<never> {
    throw new Error("Not used by Workflow tests.");
  }

  tryGetDefaultConfig(): Promise<null> {
    return Promise.resolve(null);
  }

  upsert(): Promise<never> {
    throw new Error("Not used by Workflow tests.");
  }

  validateApiKey(): Promise<never> {
    throw new Error("Not used by Workflow tests.");
  }

  getCodexStatus(): Promise<never> {
    throw new Error("Not used by Workflow tests.");
  }

  refreshCodexForGateway(): Promise<never> {
    throw new Error("Not used by Workflow tests.");
  }

  getDefaultSnapshot(): Promise<never> {
    throw new Error("Not used by Workflow tests.");
  }

  getInheritedValues(): Promise<never> {
    throw new Error("Not used by Workflow tests.");
  }

  saveDefaultConfig(): Promise<never> {
    throw new Error("Not used by Workflow tests.");
  }

  upsertCost(): Promise<never> {
    throw new Error("Not used by Workflow tests.");
  }

  translate(): Promise<never> {
    throw new Error("Not used by Workflow tests.");
  }

  delete(): Promise<void> {
    return Promise.resolve();
  }

  testConnection(): Promise<{ connected: boolean }> {
    return Promise.resolve({ connected: false });
  }

  isManagedProvider(): boolean {
    return false;
  }

  setDefault(): Promise<void> {
    return Promise.resolve();
  }

  deleteDefaultConfig(): Promise<void> {
    return Promise.resolve();
  }

  listCosts(): Promise<[]> {
    return Promise.resolve([]);
  }

  deleteCost(): Promise<void> {
    return Promise.resolve();
  }

  estimateCost(): number {
    return 0;
  }
}
