import {
  type ModelProviderExecution,
  ModelProviderService,
} from "@langwatch/model-provider-contract";
import {
  ManagedProviderService,
  type BuildManagedProviderParametersInput,
} from "@langwatch/enterprise-managed-provider-contract";

function unusedTestDoubleMethod(): never {
  throw new Error(
    "This ModelProviderService test-double method is not used by this test.",
  );
}

/** Complete contract implementations keep test callers on the public service boundary. */
export class TestModelProviderService extends ModelProviderService {
  constructor(
    private readonly executionProviders: Record<string, ModelProviderExecution> = {},
  ) {
    super();
  }

  async listForProject() {
    return unusedTestDoubleMethod();
  }

  async listForOrganization() {
    return unusedTestDoubleMethod();
  }

  async getForProject() {
    return unusedTestDoubleMethod();
  }

  async tryGetProviderForProject() {
    return null;
  }

  async tryFindRowServingModel() {
    return null;
  }

  async getExecutionProviders() {
    return this.executionProviders;
  }

  async prepareExecution() {
    return unusedTestDoubleMethod();
  }

  async upsert() {
    return unusedTestDoubleMethod();
  }

  async delete() {}

  async validateApiKey() {
    return unusedTestDoubleMethod();
  }

  async testConnection() {
    return unusedTestDoubleMethod();
  }

  async getCodexStatus() {
    return unusedTestDoubleMethod();
  }

  isManagedProvider() {
    return false;
  }

  async getDefaultSnapshot() {
    return unusedTestDoubleMethod();
  }

  async getInheritedValues() {
    return unusedTestDoubleMethod();
  }

  async tryGetResolvedDefault() {
    return null;
  }

  async resolveModelForFeature(): Promise<never> {
    return unusedTestDoubleMethod();
  }

  async tryFindAlternateModel(): Promise<never> {
    return unusedTestDoubleMethod();
  }

  async setDefault() {}

  async saveDefaultConfig() {
    return unusedTestDoubleMethod();
  }

  async tryGetDefaultConfig() {
    return null;
  }

  async deleteDefaultConfig() {}

  async listCosts() {
    return unusedTestDoubleMethod();
  }

  async upsertCost() {
    return unusedTestDoubleMethod();
  }

  async deleteCost() {}

  estimateCost() {
    return 0;
  }

  async translate() {
    return unusedTestDoubleMethod();
  }
}

export class TestManagedProviderService extends ManagedProviderService {
  isManagedProvider() {
    return false;
  }

  async buildLitellmParameters(input: BuildManagedProviderParametersInput) {
    return input.params;
  }
}

export const testModelProviders = new TestModelProviderService();
export const testManagedProviders = new TestManagedProviderService();
