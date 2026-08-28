/**
 * @vitest-environment node
 *
 * The stored-objects read route serves trace and scenario bytes. Its
 * API-key branch used to check TENANCY only — the key's project against the
 * object's owner — and the comment called such a caller a "project-scoped
 * full reader on this legacy-key surface". That was true when the only key
 * reaching this route was a legacy project key, which carries full project
 * access by design. A scoped API key does not, so a key granted, say, only
 * `prompts:view` was still served trace content.
 *
 * These pin the ceiling on both gates: the pre-read one, which admits a
 * caller holding EITHER file-view permission, and the post-read one, which
 * demands the category the object's purpose maps to.
 */
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { enforceApiKeyCeiling } = vi.hoisted(() => ({
  enforceApiKeyCeiling: vi.fn(),
}));

vi.mock("~/server/api-key/auth-middleware", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  enforceApiKeyCeiling,
}));
vi.mock("~/server/auth/permissions", () => ({
  requireProjectPermission: vi.fn(),
}));
vi.mock("~/server/rateLimit", () => ({ rateLimit: vi.fn() }));

import { ApiKeyPermissionDeniedError } from "~/server/api-key/errors";
import { authorizeFilePurpose, authorizeFileRead } from "../[[...route]]/app";

const PROJECT = "project-1";

/** A resolved scoped API key; only its presence matters to these gates. */
const KEY = { type: "apiKey", apiKeyId: "key-1" } as never;

/**
 * Answers the ceiling the way the real one does: allow the permissions the
 * key holds, and raise the ceiling's own denial for anything else.
 */
function keyHolding(...held: string[]) {
  enforceApiKeyCeiling.mockImplementation(
    async ({ permission }: { permission: string }) => {
      if (!held.includes(permission)) {
        throw new ApiKeyPermissionDeniedError(permission as never);
      }
    },
  );
}

describe("stored-object reads by API key", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given a key in the owning project", () => {
    describe("when it holds neither file-view permission", () => {
      it("is refused, though its tenancy checks out", async () => {
        keyHolding("prompts:view");

        await expect(
          authorizeFileRead({
            apiKeyProjectId: PROJECT,
            resolvedToken: KEY,
            userId: undefined,
            ownerProjectId: PROJECT,
          }),
        ).rejects.toBeInstanceOf(HTTPException);
      });
    });

    describe("when it holds one of the file-view permissions", () => {
      it("passes the pre-read gate", async () => {
        keyHolding("scenarios:view");

        await expect(
          authorizeFileRead({
            apiKeyProjectId: PROJECT,
            resolvedToken: KEY,
            userId: undefined,
            ownerProjectId: PROJECT,
          }),
        ).resolves.toBeUndefined();
      });
    });
  });

  describe("given a key past the pre-read gate", () => {
    describe("when the object's purpose needs the other category", () => {
      it("is refused once the purpose is known", async () => {
        // Enough to enter (scenarios:view), not enough for trace content.
        keyHolding("scenarios:view");

        await expect(
          authorizeFilePurpose({
            resolvedToken: KEY,
            userId: undefined,
            ownerProjectId: PROJECT,
            purpose: "trace_content",
          }),
        ).rejects.toBeInstanceOf(HTTPException);
      });
    });

    describe("when the object's purpose matches what it holds", () => {
      it("is served", async () => {
        keyHolding("traces:view");

        await expect(
          authorizeFilePurpose({
            resolvedToken: KEY,
            userId: undefined,
            ownerProjectId: PROJECT,
            purpose: "trace_content",
          }),
        ).resolves.toBeUndefined();
      });
    });
  });

  describe("given a key from another project", () => {
    it("is refused on tenancy before its permissions are consulted", async () => {
      keyHolding("traces:view", "scenarios:view");

      await expect(
        authorizeFileRead({
          apiKeyProjectId: "project-other",
          resolvedToken: KEY,
          userId: undefined,
          ownerProjectId: PROJECT,
        }),
      ).rejects.toBeInstanceOf(HTTPException);
      expect(enforceApiKeyCeiling).not.toHaveBeenCalled();
    });
  });
});
