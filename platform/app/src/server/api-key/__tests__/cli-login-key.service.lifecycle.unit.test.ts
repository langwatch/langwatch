/**
 * The login key as the anchor of a CLI session's credentials: its expiry
 * follows the session, and every revoke of it cascades to the ingest keys
 * parented to it without failing the caller.
 *
 * Feature: specs/ai-gateway/governance/ingest-api-key-lifecycle.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";
import type { ApiKeyService } from "../api-key.service";
import {
  CliLoginKeyService,
  loginKeyExpiresAt,
} from "../cli-login-key.service";
import { ApiKeyAlreadyRevokedError, ApiKeyNotFoundError } from "../errors";

const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_START = Date.UTC(2026, 8, 1);
const REFRESH_WINDOW_MS = 90 * DAY_MS;

describe("loginKeyExpiresAt", () => {
  describe("given no session ceiling", () => {
    /** @scenario "A refresh extends the login key's expiry with the session" */
    it("moves with each refresh to the end of the new refresh window", () => {
      const refreshedAt = SESSION_START + 10 * DAY_MS;

      const expiresAt = loginKeyExpiresAt({
        nowMs: refreshedAt,
        sessionStartedAtMs: SESSION_START,
        maxSessionDurationDays: 0,
        refreshWindowMs: REFRESH_WINDOW_MS,
      });

      expect(expiresAt.getTime()).toBe(refreshedAt + REFRESH_WINDOW_MS);
    });
  });

  describe("given a session ceiling shorter than the refresh window", () => {
    /** @scenario "A refresh extends the login key's expiry with the session" */
    it("never moves past the ceiling counted from the session start", () => {
      const refreshedAt = SESSION_START + 10 * DAY_MS;

      const expiresAt = loginKeyExpiresAt({
        nowMs: refreshedAt,
        sessionStartedAtMs: SESSION_START,
        maxSessionDurationDays: 30,
        refreshWindowMs: REFRESH_WINDOW_MS,
      });

      expect(expiresAt.getTime()).toBe(SESSION_START + 30 * DAY_MS);
    });

    it("keeps the refresh window while it ends before the ceiling", () => {
      const expiresAt = loginKeyExpiresAt({
        nowMs: SESSION_START,
        sessionStartedAtMs: SESSION_START,
        maxSessionDurationDays: 365,
        refreshWindowMs: REFRESH_WINDOW_MS,
      });

      expect(expiresAt.getTime()).toBe(SESSION_START + REFRESH_WINDOW_MS);
    });
  });
});

describe("CliLoginKeyService.revokeSessionKey", () => {
  const revoke = vi.fn();
  const revokeForSession = vi.fn();
  let service: CliLoginKeyService;

  beforeEach(() => {
    vi.clearAllMocks();
    revoke.mockResolvedValue({});
    revokeForSession.mockResolvedValue({ revokedCount: 2 });
    service = new CliLoginKeyService({
      prisma: {} as PrismaClient,
      apiKeyService: { revoke } as unknown as ApiKeyService,
      ingestKeys: { revokeForSession },
    });
  });

  describe("given a login key with ingest keys under it", () => {
    it("revokes the login key with the cause given, then its children as session", async () => {
      const result = await service.revokeSessionKey({
        apiKeyId: "ak_login",
        userId: "user_1",
        organizationId: "org_1",
        cause: "user",
      });

      expect(result).toEqual({ loginKeyRevoked: true, ingestKeysRevoked: 2 });
      expect(revoke).toHaveBeenCalledWith(
        expect.objectContaining({ id: "ak_login", cause: "user" }),
      );
      expect(revokeForSession).toHaveBeenCalledWith({
        parentApiKeyId: "ak_login",
        userId: "user_1",
        organizationId: "org_1",
        cause: "session",
      });
      expect(revoke).toHaveBeenCalledBefore(revokeForSession);
    });

    /** @scenario "A session past its ceiling has its keys retired with cause expired" */
    it("passes expired through to the children when the session ran out", async () => {
      await service.revokeSessionKey({
        apiKeyId: "ak_login",
        userId: "user_1",
        organizationId: "org_1",
        cause: "expired",
      });

      expect(revoke).toHaveBeenCalledWith(
        expect.objectContaining({ id: "ak_login", cause: "expired" }),
      );
      expect(revokeForSession).toHaveBeenCalledWith(
        expect.objectContaining({ cause: "expired" }),
      );
    });
  });

  describe("given a login key whose ingest keys cannot be revoked", () => {
    /** @scenario "A cascade that fails does not fail the logout" */
    it("still revokes the login key and answers without a failure", async () => {
      revokeForSession.mockRejectedValue(new Error("postgres is down"));

      const result = await service.revokeSessionKey({
        apiKeyId: "ak_login",
        userId: "user_1",
        organizationId: "org_1",
        cause: "user",
      });

      expect(result).toEqual({ loginKeyRevoked: true, ingestKeysRevoked: 0 });
      expect(revoke).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a login key already revoked", () => {
    it("still runs the cascade, so a child left behind is retired now", async () => {
      revoke.mockRejectedValue(new ApiKeyAlreadyRevokedError("ak_login"));

      const result = await service.revokeSessionKey({
        apiKeyId: "ak_login",
        userId: "user_1",
        organizationId: "org_1",
        cause: "user",
      });

      expect(result).toEqual({ loginKeyRevoked: false, ingestKeysRevoked: 2 });
    });
  });

  describe("given a login key that no longer exists", () => {
    it("answers nothing revoked and runs no cascade", async () => {
      revoke.mockRejectedValue(new ApiKeyNotFoundError("ak_login"));

      const result = await service.revokeSessionKey({
        apiKeyId: "ak_login",
        userId: "user_1",
        organizationId: "org_1",
        cause: "expired",
      });

      expect(result).toEqual({ loginKeyRevoked: false, ingestKeysRevoked: 0 });
      expect(revokeForSession).not.toHaveBeenCalled();
    });
  });
});

describe("CliLoginKeyService.revokeLoginKeysForDevice", () => {
  describe("given a device that signs in again under the same label", () => {
    /** @scenario "A re-login names rotation as the cause of the login key it replaces" */
    it("revokes the previous login key as a rotation and its children as rotation too", async () => {
      const revoke = vi.fn().mockResolvedValue({});
      const revokeForSession = vi.fn().mockResolvedValue({ revokedCount: 1 });
      const findMany = vi.fn().mockResolvedValue([{ id: "ak_previous" }]);
      const service = new CliLoginKeyService({
        prisma: { apiKey: { findMany } } as unknown as PrismaClient,
        apiKeyService: { revoke } as unknown as ApiKeyService,
        ingestKeys: { revokeForSession },
      });

      await service.revokeLoginKeysForDevice({
        userId: "user_1",
        organizationId: "org_1",
        deviceLabel: "laptop",
        exceptApiKeyId: "ak_fresh",
      });

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: "org_1",
            userId: "user_1",
            createdByDeviceLabel: "laptop",
            revokedAt: null,
            id: { not: "ak_fresh" },
          }),
        }),
      );
      expect(revoke).toHaveBeenCalledWith(
        expect.objectContaining({ id: "ak_previous", cause: "rotation" }),
      );
      // The new session is live, so the children have to say re-mintable.
      // "session" would read to an older CLI as a person's decision.
      expect(revokeForSession).toHaveBeenCalledWith(
        expect.objectContaining({
          parentApiKeyId: "ak_previous",
          cause: "rotation",
        }),
      );
    });
  });
});
