import type { Secret } from "@langwatch/secret-contract";

export abstract class SecretRepository {
  abstract list(projectId: string): Promise<Secret[]>;
  abstract get(projectId: string, id: string): Promise<Secret>;
  abstract count(projectId: string): Promise<number>;
  abstract create(input: {
    projectId: string;
    name: string;
    encryptedValue: string;
    actorId: string;
  }): Promise<Secret>;
  abstract update(input: {
    projectId: string;
    id: string;
    encryptedValue: string;
    actorId: string;
  }): Promise<Secret>;
  abstract delete(projectId: string, id: string): Promise<void>;
}
