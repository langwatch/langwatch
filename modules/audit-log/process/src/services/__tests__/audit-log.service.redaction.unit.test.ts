import { describe, expect, it, vi } from "vitest";

import type { AuditLogRepository } from "../../repositories/audit-log.repository.ts";
import { AuditLogService } from "../audit-log.service.ts";

function serviceWithRecordingRepository() {
  const create = vi.fn<AuditLogRepository["create"]>(async () => ({ id: "audit", occurredAt: 0 }));
  const service = AuditLogService.create({
    repository: {
      create,
      hasRecordedSince: async () => false,
      findEntityHistory: async () => [],
    },
    maxArgsBytes: 64 * 1024,
  });

  return { create, service };
}

describe("AuditLogService.record redaction", () => {
  /** @scenario "Secret-bearing argument values are never stored" */
  it("replaces secret-bearing values at any depth and keeps everything else", async () => {
    const { create, service } = serviceWithRecordingRepository();

    await service.record({
      userId: "user_operator",
      organizationId: "organization_1",
      action: "admin/update/organization",
      targetKind: "organization",
      targetId: "organization_1",
      args: {
        id: "organization_1",
        email: "owner@example.com",
        password: "hunter2",
        hasPassword: true,
        maxTokens: 512,
        data: { sso: { client_secret: "s3cret", clientId: "client_1" }, "x-api-key": "sk-1" },
        sessions: [{ accessToken: "at-1", userId: "user_2" }],
      },
      metadata: { authorization: "Bearer abc", reason: "support ticket" },
    });

    expect(create).toHaveBeenCalledWith({
      userId: "user_operator",
      organizationId: "organization_1",
      action: "admin/update/organization",
      targetKind: "organization",
      targetId: "organization_1",
      args: {
        id: "organization_1",
        email: "owner@example.com",
        password: "[redacted]",
        hasPassword: true,
        maxTokens: 512,
        data: {
          sso: { client_secret: "[redacted]", clientId: "client_1" },
          "x-api-key": "[redacted]",
        },
        sessions: [{ accessToken: "[redacted]", userId: "user_2" }],
      },
      metadata: { authorization: "[redacted]", reason: "support ticket" },
    });
  });

  /** @scenario "Secret-bearing argument values are never stored" */
  it.each([
    ["secretAccessKey", "aws-secret"],
    ["AWS_SECRET_ACCESS_KEY", "aws-secret"],
    ["tokens", ["t-1", "t-2"]],
    ["secrets", { a: "s-1" }],
    ["apiKeys", ["sk-1"]],
    ["APIKEY", "sk-1"],
    ["passwordHash", "$2b$hash"],
    ["tokenHash", "h-1"],
    ["backupCodes", ["111111", "222222"]],
    ["signingKey", "k-1"],
    ["encryptionKey", "k-2"],
    ["privateKey", "-----BEGIN-----"],
    ["refreshToken", "rt-1"],
    ["id_token", "jwt"],
    ["set-cookie", "session=1"],
    ["credentials", { username: "u", pass: "p" }],
    ["pin_password", 1234],
    ["userHashKey", "h-1"],
    ["passkeySignupClaimHash", "c-1"],
  ])("redacts the value under %s", async (key, value) => {
    const { create, service } = serviceWithRecordingRepository();

    await service.record({
      userId: "user_operator",
      action: "admin/update/project",
      args: { [key]: value },
    });

    expect(create.mock.calls[0]?.[0].args).toEqual({ [key]: "[redacted]" });
  });

  it.each([
    ["apiKeyId", "key_1"],
    ["tokenId", "token_1"],
    ["secretName", "OPENAI_API_KEY"],
    ["accessKeyId", "AKIA_EXAMPLE"],
    ["credentialIds", ["cred_1"]],
    ["tokenType", "Bearer"],
    ["secretCount", 3],
    ["tokenExpiresAt", "2026-10-02T00:00:00.000Z"],
    ["maxTokens", 512],
    ["prompt_tokens", 20],
    ["hasPassword", true],
    ["password", null],
    ["hashKeyId", "key_1"],
    ["hasUserHashKey", true],
  ])("keeps the value under %s", async (key, value) => {
    const { create, service } = serviceWithRecordingRepository();

    await service.record({
      userId: "user_operator",
      action: "admin/update/project",
      args: { [key]: value },
    });

    expect(create.mock.calls[0]?.[0].args).toEqual({ [key]: value });
  });
});
