import { SecretDuplicateError, SecretNotFoundError } from "@langwatch/secret-contract";
import { describe, expect, it } from "vitest";
import { MemorySecretRepository } from "../memory.secret.repository.ts";

function stored(name: string, projectId = "project-1") {
  return { projectId, name, encryptedValue: `encrypted(${name})`, actorId: "user-1" };
}

describe("MemorySecretRepository", () => {
  describe("when a project holds several secrets", () => {
    it("answers metadata by name, carrying no ciphertext", async () => {
      const repository = MemorySecretRepository.create();
      await repository.create(stored("OPENAI_API_KEY"));
      await repository.create(stored("ANTHROPIC_API_KEY"));
      await repository.create(stored("OTHER_KEY", "project-2"));

      const rows = await repository.findAll({ projectId: "project-1" });

      expect(rows.map((row) => row.name)).toEqual(["ANTHROPIC_API_KEY", "OPENAI_API_KEY"]);
      expect(rows[0]).not.toHaveProperty("encryptedValue");
      await expect(repository.count({ projectId: "project-1" })).resolves.toBe(2);
    });

    it("hands the ciphertext out only through the value read", async () => {
      const repository = MemorySecretRepository.create();
      await repository.create(stored("OPENAI_API_KEY"));

      await expect(repository.findAllValues({ projectId: "project-1" })).resolves.toEqual([
        { name: "OPENAI_API_KEY", encryptedValue: "encrypted(OPENAI_API_KEY)" },
      ]);
    });
  });

  describe("when a name is already taken in the project", () => {
    it("refuses the write the way the unique index does", async () => {
      const repository = MemorySecretRepository.create();
      await repository.create(stored("OPENAI_API_KEY"));

      await expect(repository.create(stored("OPENAI_API_KEY"))).rejects.toBeInstanceOf(
        SecretDuplicateError,
      );
      await expect(repository.create(stored("OPENAI_API_KEY", "project-2"))).resolves.toMatchObject(
        { projectId: "project-2" },
      );
    });
  });

  describe("when a row belongs to another project", () => {
    it("answers absence on the read and refuses both writes", async () => {
      const repository = MemorySecretRepository.create();
      const created = await repository.create(stored("OPENAI_API_KEY"));
      const elsewhere = { projectId: "project-2", id: created.id };

      await expect(repository.findById(elsewhere)).resolves.toBeUndefined();
      await expect(
        repository.update({ ...elsewhere, encryptedValue: "encrypted(x)", actorId: "user-1" }),
      ).rejects.toBeInstanceOf(SecretNotFoundError);
      await expect(repository.delete(elsewhere)).rejects.toBeInstanceOf(SecretNotFoundError);
    });
  });

  describe("when a value is replaced", () => {
    it("keeps the metadata and swaps the ciphertext", async () => {
      const repository = MemorySecretRepository.create();
      const created = await repository.create(stored("OPENAI_API_KEY"));

      await repository.update({
        projectId: "project-1",
        id: created.id,
        encryptedValue: "encrypted(rotated)",
        actorId: "user-2",
      });

      await expect(repository.findAllValues({ projectId: "project-1" })).resolves.toEqual([
        { name: "OPENAI_API_KEY", encryptedValue: "encrypted(rotated)" },
      ]);
    });
  });
});
