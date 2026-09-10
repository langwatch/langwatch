import {
  type ModelProviderApi,
  type ModelCostEstimateInput,
  type ModelProviderCredentialVerdict,
} from "@langwatch/model-provider-contract";

export class TestModelProviderService implements ModelProviderApi {
  readonly costInputs: ModelCostEstimateInput[] = [];

  constructor(private readonly cost = 0) {}

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

  findProviderForProject(): Promise<null> {
    return Promise.resolve(null);
  }

  findRowServingModel(): Promise<null> {
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

  testConnection(): Promise<ModelProviderCredentialVerdict> {
    return Promise.resolve({
      outcome: "unchecked",
      valid: true,
      reason: "provider_not_probeable",
    });
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

  findResolvedDefault(): Promise<null> {
    return Promise.resolve(null);
  }

  resolveModelForFeature(): Promise<never> {
    throw new Error("Not used by Trace tests.");
  }

  findAlternateModel(): Promise<never> {
    throw new Error("Not used by Trace tests.");
  }

  setDefault(): Promise<void> {
    return Promise.resolve();
  }

  saveDefaultConfig(): Promise<never> {
    throw new Error("Not used by Trace tests.");
  }

  assertApiKeyMayWriteDefaultScopes(): Promise<never> {
    throw new Error("Not used by Trace tests.");
  }

  findDefaultConfig(): Promise<null> {
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

  applyCodexCodingDefaults(): Promise<void> {
    return Promise.resolve();
  }

  translate(): Promise<never> {
    throw new Error("Not used by Trace tests.");
  }

  upsertUnattributed(): Promise<never> {
    throw new Error("Not used by Trace tests.");
  }

  validateStoredKey(): Promise<ModelProviderCredentialVerdict> {
    return Promise.resolve({
      outcome: "unchecked",
      valid: true,
      reason: "provider_not_probeable",
    });
  }

  startCodexDeviceSignIn(): Promise<never> {
    throw new Error("Not used by Trace tests.");
  }

  pollCodexDeviceSignIn(): Promise<never> {
    throw new Error("Not used by Trace tests.");
  }

  getDefaultSnapshotUnattributed(): Promise<never> {
    throw new Error("Not used by Trace tests.");
  }

  findModelLimits(): null {
    return null;
  }

  previewCostRuleMatchingSpans(): Promise<never> {
    throw new Error("Not used by Trace tests.");
  }
}
