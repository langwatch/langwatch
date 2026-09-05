import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { PrismaSsoCredentialStore } from "../repositories/sso-credential.prisma.repository";

/**
 * The credential vault at the boundary where it actually protects something
 * (D09 — see specs/identity/sso-idp-termination.feature).
 *
 * What is under test is the one property the aggregate's reference design
 * rests on: the value goes to the database unreadable, and comes back out
 * readable, and neither half is somebody else's to ask for. The encryption is
 * `~/utils/encryption` and is not re-tested here — what is tested is that the
 * store uses it, which is the mistake worth catching.
 */

const ORG = "org_acme";
const CONNECTION = "ssoconn_acme";
const SECRET = "s3cret-from-the-identity-provider";

describe("given the deployment's credential secret is set", () => {
  let rows: Map<string, { organizationId: string; ciphertext: string }>;
  let store: PrismaSsoCredentialStore;

  beforeEach(() => {
    rows = new Map();
    const prisma = {
      ssoCredential: {
        create: vi.fn(async ({ data }: { data: Record<string, string> }) => {
          rows.set(data.id!, {
            organizationId: data.organizationId!,
            ciphertext: data.ciphertext!,
          });
          return data;
        }),
        findFirst: vi.fn(
          async ({
            where,
          }: {
            where: { id: string; organizationId: string };
          }) => {
            const row = rows.get(where.id);
            // The organization predicate is the point of the assertion below,
            // so the stub honours it rather than ignoring it.
            return row && row.organizationId === where.organizationId
              ? row
              : null;
          },
        ),
      },
    } as unknown as PrismaClient;
    store = new PrismaSsoCredentialStore(prisma);
  });

  describe("when a client secret is kept", () => {
    /** @scenario "A stored credential is unreadable without the deployment's key" */
    it("writes something other than the secret and reads the secret back", async () => {
      const ref = await store.put({
        organizationId: ORG,
        connectionId: CONNECTION,
        kind: "oidc-client-secret",
        value: SECRET,
      });

      const written = rows.get(ref)?.ciphertext ?? "";
      expect(written).not.toContain(SECRET);
      expect(written).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
      expect(await store.read({ organizationId: ORG, ref })).toBe(SECRET);
    });

    /** @scenario "A credential belongs to the organization that stored it" */
    it("answers nothing to another organization holding the reference", async () => {
      const ref = await store.put({
        organizationId: ORG,
        connectionId: CONNECTION,
        kind: "oidc-client-secret",
        value: SECRET,
      });

      expect(
        await store.read({ organizationId: "org_someone_else", ref }),
      ).toBeNull();
    });

    it("mints a fresh reference per write, so a rotation never edits one in place", async () => {
      const first = await store.put({
        organizationId: ORG,
        connectionId: CONNECTION,
        kind: "oidc-client-secret",
        value: SECRET,
      });
      const second = await store.put({
        organizationId: ORG,
        connectionId: CONNECTION,
        kind: "oidc-client-secret",
        value: "rotated",
      });

      expect(second).not.toBe(first);
      expect(await store.read({ organizationId: ORG, ref: first })).toBe(
        SECRET,
      );
    });
  });

  describe("when a stored value cannot be decrypted", () => {
    it("answers nothing rather than throwing", async () => {
      // A row written under a secret since rotated. The connection stops being
      // dialable, which is true; the fold that reads this must not stop.
      rows.set("ssocred_corrupt", {
        organizationId: ORG,
        ciphertext: "aa:bb:cc",
      });

      expect(
        await store.read({ organizationId: ORG, ref: "ssocred_corrupt" }),
      ).toBeNull();
    });
  });
});
