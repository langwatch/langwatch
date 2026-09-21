/**
 * A storage refusal is logged before it reaches the customer: better-auth
 * turns an adapter throw into a redirect carrying only the error CODE, which
 * left production undiagnosable from the logs alone.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const logged = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("@langwatch/observability", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@langwatch/observability")>()),
  createLogger: () => logged,
}));

// This package runs with `isolate: false`, so a sibling that loaded the
// storage adapter first would have captured the REAL logger at module scope
// and the mock above would reach nothing. Resetting makes the import below
// re-evaluate the chain against it, whatever ran earlier.
vi.resetModules();

const { identityStack, signUp } = await import("./support/storage-adapter-stack.ts");

const EMAIL = "member@acme.com";

describe("given a finalized user on the identity branch", () => {
  let stack: ReturnType<typeof identityStack>;

  beforeEach(() => {
    logged.error.mockClear();
    stack = identityStack();
    stack.gate.open = () => true;
  });

  describe("when better-auth issues an account operation the branch cannot serve", () => {
    /** @scenario "A refused account operation is logged before it reaches the customer" */
    it("logs the refusal at error with the shape that caused it", async () => {
      await signUp(stack.auth, EMAIL);
      const context = await stack.auth.$context;

      await expect(
        context.adapter.findMany({
          model: "account",
          where: [
            { field: "userId", value: stack.db.user?.[0]?.id as string },
            { field: "scope", value: "openid" },
          ],
        }),
      ).rejects.toMatchObject({
        body: { code: "identity_unsupported_storage_query" },
      });

      expect(logged.error).toHaveBeenCalledTimes(1);
      const [fields, message] = logged.error.mock.calls[0] ?? [];
      // The shape is the whole diagnostic value: without it the log says
      // only that something was refused, which is what the error page
      // already said.
      expect(fields).toMatchObject({
        detail: expect.stringContaining("scope eq, userId eq"),
      });
      expect(message).toContain("refused a better-auth account operation");
    });

    /** @scenario "A refused account operation is logged before it reaches the customer" */
    it("logs the linkage rewrite that broke production sign-in", async () => {
      await signUp(stack.auth, EMAIL);
      const userId = stack.db.user?.[0]?.id as string;
      const context = await stack.auth.$context;
      await context.internalAdapter.linkAccount({
        userId,
        providerId: "google",
        issuer: "local:oauth:google",
        accountId: "sub-google-1",
      });
      const google = (await context.internalAdapter.findAccounts(userId)).find(
        (row) => row.providerId === "google",
      );
      logged.error.mockClear();

      await expect(
        context.adapter.update({
          model: "account",
          where: [{ field: "id", value: google?.id as string }],
          update: { providerId: "github" },
        }),
      ).rejects.toMatchObject({
        body: { code: "identity_unsupported_storage_query" },
      });

      expect(logged.error).toHaveBeenCalledTimes(1);
      expect(logged.error.mock.calls[0]?.[0]).toMatchObject({
        detail: expect.stringContaining("linkage columns (providerId)"),
      });
    });
  });
});
