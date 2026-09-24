/**
 * What the CLI login-key sweep may touch: bounded by the reserved name
 * prefix and the clock; revoked through the caller's own `revoke` for cleanup.
 * Spec: modules/api-key/specs/api-key.feature
 */
import { ApiKeyAlreadyRevokedError } from "@langwatch/api-key-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import type { ApiKeyRepository } from "../../repositories/api-key.repository.ts";
import { MemoryApiKeyDatabase } from "../../repositories/memory/memory.api-key.database.ts";
import { MemoryApiKeyRepository } from "../../repositories/memory/memory.api-key.repository.ts";
import { CliLoginKeyReapService } from "../cli-login-key-reap.service.ts";

const NOW = Temporal.Instant.from("2026-01-01T00:00:00.000Z");

function repositoryDouble(
  elapsed: { id: string; userId: string | null; organizationId: string }[] = [],
) {
  const findElapsedLoginKeys = vi.fn<ApiKeyRepository["findElapsedLoginKeys"]>(async () => elapsed);
  const repository = Object.assign(
    MemoryApiKeyRepository.create({ memory: MemoryApiKeyDatabase.create() }),
    { findElapsedLoginKeys },
  );
  return { repository, findElapsedLoginKeys };
}

describe("the CLI login-key sweep", () => {
  describe("given a login key whose session has run out", () => {
    /** @scenario "The CLI login-key sweep retires elapsed sessions and their ingest keys" */
    it("revokes it through the caller's own revoke rather than a raw update", async () => {
      const { repository } = repositoryDouble([
        { id: "ak_login", userId: "user_1", organizationId: "org_1" },
      ]);
      const revoke = vi.fn(async () => ({}));

      await CliLoginKeyReapService.create({ repository, revoke, now: () => NOW }).reap();

      expect(revoke).toHaveBeenCalledWith({
        id: "ak_login",
        organizationId: "org_1",
        userId: "user_1",
      });
    });

    /** @scenario "The CLI login-key sweep retires elapsed sessions and their ingest keys" */
    it("reads the same instant it compares against", async () => {
      const { repository, findElapsedLoginKeys } = repositoryDouble([]);

      await CliLoginKeyReapService.create({
        repository,
        revoke: vi.fn(),
        now: () => NOW,
      }).reap();

      expect(findElapsedLoginKeys).toHaveBeenCalledWith({ now: NOW });
    });

    it("answers how many keys it retired", async () => {
      const { repository } = repositoryDouble([
        { id: "ak_a", userId: "user_1", organizationId: "org_1" },
        { id: "ak_b", userId: "user_2", organizationId: "org_1" },
      ]);

      const count = await CliLoginKeyReapService.create({
        repository,
        revoke: vi.fn(async () => ({})),
        now: () => NOW,
      }).reap();

      expect(count).toBe(2);
    });

    it("skips a row with no user rather than failing the whole sweep", async () => {
      const { repository } = repositoryDouble([
        { id: "ak_orphan", userId: null, organizationId: "org_1" },
      ]);
      const revoke = vi.fn(async () => ({}));

      const count = await CliLoginKeyReapService.create({
        repository,
        revoke,
        now: () => NOW,
      }).reap();

      expect(revoke).not.toHaveBeenCalled();
      expect(count).toBe(0);
    });

    it("tolerates a key already revoked by a racing caller", async () => {
      const { repository } = repositoryDouble([
        { id: "ak_login", userId: "user_1", organizationId: "org_1" },
      ]);
      const revoke = vi.fn(async () => {
        throw new ApiKeyAlreadyRevokedError("ak_login");
      });

      await expect(
        CliLoginKeyReapService.create({ repository, revoke, now: () => NOW }).reap(),
      ).resolves.toBe(0);
    });

    it("logs and continues past an unexpected failure on one key", async () => {
      const { repository } = repositoryDouble([
        { id: "ak_fails", userId: "user_1", organizationId: "org_1" },
        { id: "ak_ok", userId: "user_2", organizationId: "org_1" },
      ]);
      const revoke = vi.fn(async ({ id }: { id: string }) => {
        if (id === "ak_fails") throw new Error("postgres is down");
        return {};
      });

      const count = await CliLoginKeyReapService.create({
        repository,
        revoke,
        now: () => NOW,
      }).reap();

      expect(count).toBe(1);
    });
  });

  describe("given no caller-supplied clock", () => {
    it("reads the wall clock at the moment it sweeps", async () => {
      const { repository, findElapsedLoginKeys } = repositoryDouble([]);

      await CliLoginKeyReapService.create({ repository, revoke: vi.fn() }).reap();

      expect(findElapsedLoginKeys).toHaveBeenCalledTimes(1);
    });
  });
});
