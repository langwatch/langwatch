import { featureApi } from "@langwatch/runtime-composition/contract";
import type {
  CreateSecretInput,
  DeleteSecretInput,
  GetSecretInput,
  ListSecretsInput,
  Secret,
  UpdateSecretInput,
} from "./secret.ts";
export interface SecretCaller {
  readonly id: string;
}

export interface SecretApi {
  list(input: ListSecretsInput): Promise<Secret[]>;
  get(input: GetSecretInput): Promise<Secret>;
  getValues(input: ListSecretsInput): Promise<Record<string, string>>;
  delete(input: DeleteSecretInput): Promise<void>;
  create(input: Omit<CreateSecretInput, "actorId">, by: SecretCaller): Promise<Secret>;
  update(input: Omit<UpdateSecretInput, "actorId">, by: SecretCaller): Promise<Secret>;
}

export const SecretApi = featureApi<SecretApi>("secret");
