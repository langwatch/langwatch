import type { Secret } from "@langwatch/secret-contract";
import {
  SecretDuplicateError,
  SecretLimitReachedError,
  SecretNotFoundError,
  SecretReservedNameError,
} from "@langwatch/secret-contract";
import { describe, expect, it, vi } from "vitest";

import {
  ReversibleTestSecretEncryption,
  teamWithMembers,
} from "../../app/__tests__/secret.fixture.ts";
import type {
  CreateStoredSecretInput,
  SecretIdentity,
  SecretRepository,
  StoredSecretValue,
  UpdateStoredSecretInput,
} from "../../repositories/secret.repository.ts";
import { SecretService } from "../secret.service.ts";

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

/** Records what the service asked persistence for, and answers from arrays. */
class RecordingSecretRepository implements SecretRepository {
  readonly rows: Secret[] = [];
  readonly values: StoredSecretValue[] = [];
  readonly createCall = vi.fn();
  readonly updateCall = vi.fn();
  readonly deleteCall = vi.fn();
  countValue = 0;

  findAll(): Promise<Secret[]> {
    return Promise.resolve(this.rows);
  }

  findAllValues(): Promise<StoredSecretValue[]> {
    return Promise.resolve(this.values);
  }

  // Scoped like the real repository: a secret is addressed by project AND id,
  // so a lookup from the wrong project finds nothing.
  findById({ projectId, id }: SecretIdentity): Promise<Secret | undefined> {
    return Promise.resolve(
      this.rows.find((candidate) => candidate.id === id && candidate.projectId === projectId),
    );
  }

  count(): Promise<number> {
    return Promise.resolve(this.countValue);
  }

  create(input: CreateStoredSecretInput): Promise<Secret> {
    this.createCall(input);

    return Promise.resolve(row({ projectId: input.projectId, name: input.name }));
  }

  update(input: UpdateStoredSecretInput): Promise<Secret> {
    this.updateCall(input);

    return Promise.resolve(row({ id: input.id, projectId: input.projectId }));
  }

  delete({ projectId, id }: SecretIdentity): Promise<void> {
    this.deleteCall(projectId, id);

    return Promise.resolve();
  }
}

function createService(options?: {
  reservedNames?: readonly string[];
  maximumPerProject?: number;
  teamMembers?: readonly string[];
}) {
  const repository = new RecordingSecretRepository();
  const service = SecretService.create({
    repository,
    encryption: new ReversibleTestSecretEncryption(),
    reservedNames: options?.reservedNames ?? ["LANGY_KEY"],
    maximumPerProject: options?.maximumPerProject,
    ...teamWithMembers(options?.teamMembers ?? []),
  });

  return { repository, service };
}

describe("SecretService", () => {
  /** @scenario "Product-owned secrets are hidden and immutable" */
  /** @scenario "The stored Langy virtual-key secret is hidden and immutable" */
  it("never lists product-owned secrets", async () => {
    const { repository, service } = createService();
    repository.rows.push(row(), row({ id: "reserved", name: "LANGY_KEY" }));

    await expect(service.list({ projectId: "project-1" })).resolves.toEqual([row()]);
  });

  it("decrypts every project secret for trusted server execution", async () => {
    const { repository, service } = createService();
    repository.values.push(
      { name: "OPENAI_API_KEY", encryptedValue: "encrypted(openai)" },
      { name: "LANGY_KEY", encryptedValue: "encrypted(internal)" },
    );

    await expect(service.getValues({ projectId: "project-1" })).resolves.toEqual({
      OPENAI_API_KEY: "openai",
      LANGY_KEY: "internal",
    });
  });

  /** @scenario "The stored Langy virtual-key secret is hidden and immutable" */
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
    const { repository, service } = createService({ reservedNames: ["PRODUCT_KEY"] });

    await expect(
      service.create(
        {
          projectId: "project-1",
          name: "PRODUCT_KEY",
          value: "value",
        },
        { id: "user-1" },
      ),
    ).rejects.toBeInstanceOf(SecretReservedNameError);
    expect(repository.createCall).not.toHaveBeenCalled();
  });

  it("enforces the project limit before encrypting or writing", async () => {
    const { repository, service } = createService({ maximumPerProject: 1 });
    repository.countValue = 1;

    await expect(
      service.create(
        {
          projectId: "project-1",
          name: "NEW_KEY",
          value: "value",
        },
        { id: "user-1" },
      ),
    ).rejects.toBeInstanceOf(SecretLimitReachedError);
    expect(repository.createCall).not.toHaveBeenCalled();
  });

  /** @scenario "Writes use the authenticated user actor" */
  it("encrypts writes and records the authenticated actor", async () => {
    const { repository, service } = createService();
    repository.rows.push(row());

    await service.update(
      { projectId: "project-1", id: "secret-1", value: "rotated" },
      { id: "user-2" },
    );

    expect(repository.updateCall).toHaveBeenCalledWith({
      projectId: "project-1",
      id: "secret-1",
      encryptedValue: "encrypted(rotated)",
      actorId: "user-2",
    });
  });

  describe("when no caller is named, as for a legacy project key", () => {
    /** @scenario "A key bound to no user writes as the first member of the project's team" */
    it("attributes the create and the update to the first member of the project's team", async () => {
      const { repository, service } = createService({ teamMembers: ["user-first", "user-second"] });
      repository.rows.push(row());

      await service.create({ projectId: "project-1", name: "NEW_KEY", value: "value" });
      await service.update({ projectId: "project-1", id: "secret-1", value: "rotated" });

      expect(repository.createCall).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: "user-first" }),
      );
      expect(repository.updateCall).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: "user-first" }),
      );
    });

    /** @scenario "A key bound to no user is refused when the project's team has no member" */
    it("refuses by code and writes nothing when the team has no member", async () => {
      const { repository, service } = createService({ teamMembers: [] });
      repository.rows.push(row());

      await expect(
        service.create({ projectId: "project-1", name: "NEW_KEY", value: "value" }),
      ).rejects.toMatchObject({ code: "authenticated_actor_required" });
      await expect(
        service.update({ projectId: "project-1", id: "secret-1", value: "rotated" }),
      ).rejects.toMatchObject({ code: "authenticated_actor_required" });
      expect(repository.createCall).not.toHaveBeenCalled();
      expect(repository.updateCall).not.toHaveBeenCalled();
    });
  });

  it("preserves an atomic duplicate error from persistence", async () => {
    const { repository, service } = createService();
    repository.create = () => Promise.reject(new SecretDuplicateError("KEY"));

    await expect(
      service.create(
        {
          projectId: "project-1",
          name: "KEY",
          value: "value",
        },
        { id: "user-1" },
      ),
    ).rejects.toBeInstanceOf(SecretDuplicateError);
  });
});
