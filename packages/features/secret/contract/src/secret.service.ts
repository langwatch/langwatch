import type {
  CreateSecretInput,
  DeleteSecretInput,
  GetSecretInput,
  ListSecretsInput,
  Secret,
  UpdateSecretInput,
} from "./secret";

export abstract class SecretService {
  abstract list(input: ListSecretsInput): Promise<Secret[]>;
  abstract getValues(input: ListSecretsInput): Promise<Record<string, string>>;
  abstract get(input: GetSecretInput): Promise<Secret>;
  abstract create(input: CreateSecretInput): Promise<Secret>;
  abstract update(input: UpdateSecretInput): Promise<Secret>;
  abstract delete(input: DeleteSecretInput): Promise<void>;
}
