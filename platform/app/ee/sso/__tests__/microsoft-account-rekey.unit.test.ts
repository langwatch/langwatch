import { describe, expect, it, vi } from "vitest";
import {
  microsoftAccountKeyMove,
  microsoftProfileRekey,
} from "../microsoft-account-rekey";
import { buildSocialProviders } from "../providers";

const TENANT = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const ISSUER = `https://login.microsoftonline.com/${TENANT}/v2.0`;
const token = { sub: "pairwise-sub", oid: "object-id", iss: ISSUER };

describe("microsoftAccountKeyMove", () => {
  describe("when the id token carries sub, oid and iss", () => {
    /** @scenario "A Microsoft id token names the key move from sub to iss and oid" */
    it("moves the sub-keyed account onto the issuer and the oid", () => {
      expect(microsoftAccountKeyMove(token)).toEqual({
        legacySubject: "pairwise-sub",
        issuer: ISSUER,
        accountId: "object-id",
      });
    });
  });

  describe("when a claim is missing or unusable", () => {
    it.each([
      ["sub", { ...token, sub: undefined }],
      ["oid", { ...token, oid: "" }],
      ["iss", { ...token, iss: undefined }],
      ["a non-https iss", { ...token, iss: "local:oauth:microsoft" }],
    ])("asks for no move without %s", (_label, profile) => {
      expect(microsoftAccountKeyMove(profile)).toBeNull();
    });

    it("asks for no move when sub and oid are the same subject", () => {
      expect(
        microsoftAccountKeyMove({ ...token, sub: "same", oid: "same" }),
      ).toBeNull();
    });
  });
});

describe("microsoftProfileRekey", () => {
  const failingPrisma = () => ({
    $transaction: vi.fn(async () => {
      throw new Error("connection terminated");
    }),
  });

  describe("when the move fails", () => {
    /** @scenario "A sign-in whose account move fails is stopped instead of reaching account linking" */
    it("propagates the failure so the sign-in stops", async () => {
      const prisma = failingPrisma();
      const signIn = microsoftProfileRekey({ prisma: prisma as never });

      await expect(signIn(token)).rejects.toThrow("connection terminated");
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the token asks for no move", () => {
    it("proceeds without touching the database", async () => {
      const prisma = failingPrisma();
      const signIn = microsoftProfileRekey({ prisma: prisma as never });

      await expect(
        signIn({ ...token, oid: undefined }),
      ).resolves.toBeUndefined();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe("when there is nothing left to move", () => {
    it("proceeds", async () => {
      const prisma = { $transaction: vi.fn(async () => "unchanged") };
      const signIn = microsoftProfileRekey({ prisma: prisma as never });

      await expect(signIn(token)).resolves.toBeUndefined();
    });
  });
});

describe("buildSocialProviders", () => {
  describe("when Azure AD is configured", () => {
    it("hands the id token claims to onMicrosoftProfile before mapping the user", async () => {
      const onMicrosoftProfile = vi.fn(async () => undefined);
      const providers = buildSocialProviders(
        {
          NEXTAUTH_PROVIDER: "azure-ad",
          AZURE_AD_CLIENT_ID: "client",
          AZURE_AD_CLIENT_SECRET: "secret",
          AZURE_AD_TENANT_ID: TENANT,
        } as Parameters<typeof buildSocialProviders>[0],
        { onMicrosoftProfile },
      );

      const profile = { ...token, name: "Ada", email: "ada@acme.com" };
      // buildSocialProviders returns plain options, never the awaitable form.
      const microsoft = providers.microsoft as
        | { mapProfileToUser?: (profile: never) => unknown }
        | undefined;
      const mapped = await microsoft?.mapProfileToUser?.(profile as never);

      expect(onMicrosoftProfile).toHaveBeenCalledWith(profile);
      expect(mapped).toEqual({ name: "Ada", email: "ada@acme.com" });
    });
  });
});
