import { featureApi } from "@langwatch/runtime-composition/contract";
import type { ModelProvider } from "./model-provider.ts";
/** Callable model-provider operations shared by process peers after composition. */
export interface ModelProviderApi {
  listForProject(...args: never[]): unknown;
  listForOrganization(...args: never[]): unknown;
  getForProject(...args: never[]): unknown;
  tryGetProviderForProject(input: {
    projectId: string;
    provider: string;
  }): Promise<ModelProvider | null>;
  tryGetProviderForProject(...args: never[]): unknown;
  upsert(...args: never[]): unknown;
  delete(...args: never[]): unknown;
  testConnection(...args: never[]): unknown;
  getCodexStatus(...args: never[]): unknown;
  isManagedProvider(...args: never[]): unknown;
  getDefaultSnapshot(...args: never[]): unknown;
  getInheritedValues(...args: never[]): unknown;
  tryGetResolvedDefault(...args: never[]): unknown;
  setDefault(...args: never[]): unknown;
  saveDefaultConfig(...args: never[]): unknown;
  deleteDefaultConfig(...args: never[]): unknown;
  listCosts(...args: never[]): unknown;
  upsertCost(...args: never[]): unknown;
  deleteCost(...args: never[]): unknown;
  translate(...args: never[]): unknown;
}

export const ModelProviderApi = featureApi<ModelProviderApi>("model-provider");
