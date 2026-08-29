import type { Secret } from "@langwatch/secret-contract";
import {
  SecretDuplicateError,
  SecretLimitReachedError,
  SecretNotFoundError,
  SecretReservedNameError,
} from "@langwatch/secret-contract";
import { describe, expect, it, vi } from "vitest";
import { SecretEncryptionPort } from "../secret.port";
import { SecretRepository } from "../../repositories/secret.repository";
import { SecretService } from "../../services/secret.service";

const NOW = new Date("2026-08-24T00:00:00.000Z");

function row(input: Partial<Secret> = {}): Secret {
  return {
    id: "secret-1",
    projectId: "project-1",
    name: "OPENAI_API_KEY",
    createdAt: NOW,
    updatedAt: NOW,
    createdBy: { name: "Alex" },
    updatedBy: { name: "Alex" },
    ...input,
  };
}

class StubSecretRepository extends SecretRepository {
  readonly rows: Secret[] = [];
  readonly encryptedValues: Array<{ name: string; encryptedValue: string }> = [];
  readonly createCall = vi.fn();
  readonly updateCall = vi.fn();
  readonly deleteCall = vi.fn();
  countValue = 0;

  list(): Promise<Secret[]> {
    return Promise.resolve(this.rows);
  }

  listEncryptedValues(): Promise<Array<{ name: string; encryptedValue: string }>> {
    return Promise.resolve(this.encryptedValues);
  }

  async get(_projectId: string, id: string): Promise<Secret> {
    const secret = this.rows.find((candidate) => candidate.id === id);
    if (!secret) throw new SecretNotFoundError();
    return secret;
  }

  count(): Promise<number> {
    return Promise.resolve(this.countValue);
  }

  create(input: {
    projectId: string;
    name: string;
    encryptedValue: string;
    actorId: string;
  }): Promise<Secret> {
    this.createCall(input);
    return Promise.resolve(row({ projectId: input.projectId, name: input.name }));
  }

  update(input: {
    projectId: string;
    id: string;
    encryptedValue: string;
    actorId: string;
  }): Promise<Secret> {
    this.updateCall(input);
    return Promise.resolve(row({ id: input.id, projectId: input.projectId }));
  }

  delete(projectId: string, id: string): Promise<void> {
    this.deleteCall(projectId, id);
    return Promise.resolve();
  }
}

class StubSecretEncryption extends SecretEncryptionPort {
  encrypt(value: string): string {
    return `encrypted(${value})`;
  }

  decrypt(value: string): string {
    return value.replace(/^encrypted\((.*)\)$/, "$1");
  }
}

function createService(options?: {
  reservedNames?: readonly string[];
  maximumPerProject?: number;
}) {
  const repository = new StubSecretRepository();
  const service = SecretService.create({
    repository,
    encryption: new StubSecretEncryption(),
    reservedNames: options?.reservedNames ?? ["LANGY_KEY"],
    maximumPerProject: options?.maximumPerProject,
  });
  return { repository, service };
}

describe("SecretService", () => {
  /** @scenario "Product-owned secrets are hidden and immutable" */
  it("never lists product-owned secrets", async () => {
    const { repository, service } = createService();
    repository.rows.push(row(), row({ id: "reserved", name: "LANGY_KEY" }));

    await expect(service.list({ projectId: "project-1" })).resolves.toEqual([row()]);
  });

  it("decrypts every project secret for trusted server execution", async () => {
    const { repository, service } = createService();
    repository.encryptedValues.push(
      { name: "OPENAI_API_KEY", encryptedValue: "encrypted(openai)" },
      { name: "LANGY_KEY", encryptedValue: "encrypted(internal)" },
    );

    await expect(service.getValues({ projectId: "project-1" })).resolves.toEqual({
      OPENAI_API_KEY: "openai",
      LANGY_KEY: "internal",
    });
  });

  it("reports reserved and missing rows as not found", async () => {
    const { repository, service } = createService();
    repository.rows.push(row({ id: "reserved", name: "LANGY_KEY" }));

    await expect(service.get({ projectId: "project-1", id: "reserved" })).rejects.toBeInstanceOf(
      SecretNotFoundError,
    );
    await expect(service.delete({ projectId: "project-1", id: "missing" })).rejects.toBeInstanceOf(
      SecretNotFoundError,
    );
  });

  it("refuses a creatable reserved name before persistence", async () => {
    const { repository, service } = createService({
      reservedNames: ["PRODUCT_KEY"],
    });

    await expect(
      service.create({
        projectId: "project-1",
        name: "PRODUCT_KEY",
        value: "value",
        actorId: "user-1",
      }),
    ).rejects.toBeInstanceOf(SecretReservedNameError);
    expect(repository.createCall).not.toHaveBeenCalled();
  });

  it("enforces the project limit before encrypting or writing", async () => {
    const { repository, service } = createService({ maximumPerProject: 1 });
    repository.countValue = 1;

    await expect(
      service.create({
        projectId: "project-1",
        name: "NEW_KEY",
        value: "value",
        actorId: "user-1",
      }),
    ).rejects.toBeInstanceOf(SecretLimitReachedError);
    expect(repository.createCall).not.toHaveBeenCalled();
  });

  it("encrypts writes and records the authenticated actor", async () => {
    const { repository, service } = createService();
    repository.rows.push(row());

    await service.update({
      projectId: "project-1",
      id: "secret-1",
      value: "rotated",
      actorId: "user-2",
    });

    expect(repository.updateCall).toHaveBeenCalledWith({
      projectId: "project-1",
      id: "secret-1",
      encryptedValue: "encrypted(rotated)",
      actorId: "user-2",
    });
  });

  it("preserves an atomic duplicate error from persistence", async () => {
    const { repository, service } = createService();
    repository.create = () => Promise.reject(new SecretDuplicateError("KEY"));

    await expect(
      service.create({
        projectId: "project-1",
        name: "KEY",
        value: "value",
        actorId: "user-1",
      }),
    ).rejects.toBeInstanceOf(SecretDuplicateError);
  });
});
