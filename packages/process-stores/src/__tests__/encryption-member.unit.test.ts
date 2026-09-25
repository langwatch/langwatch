import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { describe, expect, it } from "vitest";

import { aesEncryption } from "../config-members.ts";
import { storesOwner, type StoresConfig } from "../config-owner.ts";
import { openProcessStores } from "../open-stores.ts";
import { PipelineParticipation } from "../pipeline-selection.ts";

/** main's platform/app/src/utils/encryption.ts `encrypt`, line for line. */
function mainEncrypt(text: string, hexKey: string): string {
  const key = new Uint8Array(Buffer.from(hexKey, "hex"));
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, new Uint8Array(iv));
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return `${iv.toString("hex")}:${encrypted}:${cipher.getAuthTag().toString("hex")}`;
}

/** main's `decrypt`, line for line. */
function mainDecrypt(encryptedString: string, hexKey: string): string {
  const [ivHex, encryptedData, authTagHex] = encryptedString.split(":");
  if (!ivHex || !encryptedData || !authTagHex) throw new Error("Invalid encrypted string format");
  const key = new Uint8Array(Buffer.from(hexKey, "hex"));
  const decipher = createDecipheriv("aes-256-gcm", key, new Uint8Array(Buffer.from(ivHex, "hex")));
  decipher.setAuthTag(new Uint8Array(Buffer.from(authTagHex, "hex")));
  let decrypted = decipher.update(encryptedData, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

/** The base64url `iv.tag.body` form this branch wrote before it matched main. */
function branchDotSeal(text: string, hexKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(hexKey, "hex"), iv);
  const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((part) => part.toString("base64url")).join(".");
}

const hexKey = (): string => randomBytes(32).toString("hex");
const CREDENTIAL = JSON.stringify({ OPENAI_API_KEY: "sk-fixture-not-a-real-key" });

const storesConfig: StoresConfig = {
  defaultRetentionDays: 30,
  clickhousePool: {
    override: undefined,
    replicas: undefined,
    serverMaxConcurrentQueries: undefined,
    serverNodes: undefined,
    clientsPerProcess: undefined,
  },
  rateLimit: { requests: 60, seconds: 60 },
  objectStorage: {
    backend: "file",
    localRoot: "/tmp/langwatch-encryption-member-test",
    s3: { bucket: undefined, endpoint: undefined, region: undefined },
    azure: {
      authMode: undefined,
      accountName: undefined,
      container: undefined,
      endpoint: undefined,
      authorityHost: undefined,
      tokenAudience: undefined,
      allowInsecureTokenEndpointForTests: undefined,
      identity: { tenantId: undefined, clientId: undefined, federatedTokenFile: undefined },
    },
  },
};

async function encryptionFrom(environment: Record<string, string>) {
  const resolver = SecretsResolver.over(SecretsChain.start({ environment }).withEnv());
  const members = await openProcessStores({
    name: "encryption-member-test",
    config: storesConfig,
    secrets: resolver.scopeTo(storesOwner.name, Object.values(storesOwner.secrets)),
    pipelines: PipelineParticipation.producer(),
    production: false,
  });
  return { encryption: members.read("encryption"), close: () => members.close() };
}

describe("given the encryption member", () => {
  const key = hexKey();
  const encryption = aesEncryption(Buffer.from(key, "hex"));

  describe("when it opens a value main sealed", () => {
    /** @scenario "A value main sealed opens" */
    it("reads the original plaintext", () => {
      expect(encryption.decrypt(mainEncrypt(CREDENTIAL, key))).toBe(CREDENTIAL);
    });
  });

  describe("when main opens a value it sealed", () => {
    /** @scenario "A value sealed here opens on main" */
    it("reads the original plaintext", () => {
      const sealed = encryption.encrypt(CREDENTIAL);

      expect(sealed).toMatch(/^[0-9a-f]{24}:[0-9a-f]+:[0-9a-f]{32}$/);
      expect(mainDecrypt(sealed, key)).toBe(CREDENTIAL);
    });
  });

  describe("when it opens the base64url form this branch once wrote", () => {
    /** @scenario "A value this branch once sealed in base64url still opens" */
    it("reads the original plaintext", () => {
      expect(encryption.decrypt(branchDotSeal(CREDENTIAL, key))).toBe(CREDENTIAL);
    });
  });

  describe("when the value was sealed under another key", () => {
    /** @scenario "A value sealed under another key is refused without quoting it" */
    it("throws without quoting the sealed value", () => {
      const sealed = mainEncrypt(CREDENTIAL, hexKey());

      expect(() => encryption.decrypt(sealed)).toThrow("Failed to decrypt");
      expect(() => encryption.decrypt(sealed)).not.toThrow(sealed);
    });
  });

  describe("when the value is in no known shape", () => {
    /** @scenario "A value in no known shape is refused without quoting it" */
    it.each(["not-a-sealed-value", "abc:def", "a.b.c.d", "00:11:22"])(
      "refuses %j without quoting it",
      (stored) => {
        expect(() => encryption.decrypt(stored)).toThrow(/encrypted value/);
        expect(() => encryption.decrypt(stored)).not.toThrow(stored);
      },
    );

    it("refuses an empty value", () => {
      expect(() => encryption.decrypt("")).toThrow(/encrypted value/);
    });
  });
});

describe("given a process opening its stores", () => {
  describe("when CREDENTIALS_SECRET is unset and NEXTAUTH_SECRET is set", () => {
    /** @scenario "The session secret keys the member when CREDENTIALS_SECRET is unset" */
    it("keys the member from NEXTAUTH_SECRET, as main did", async () => {
      const session = hexKey();
      const { encryption, close } = await encryptionFrom({ NEXTAUTH_SECRET: session });

      try {
        expect(encryption.decrypt(mainEncrypt(CREDENTIAL, session))).toBe(CREDENTIAL);
      } finally {
        await close();
      }
    });
  });

  describe("when both CREDENTIALS_SECRET and NEXTAUTH_SECRET are set", () => {
    /** @scenario "CREDENTIALS_SECRET keys the member when both are set" */
    it("keys the member from CREDENTIALS_SECRET", async () => {
      const credentials = hexKey();
      const { encryption, close } = await encryptionFrom({
        CREDENTIALS_SECRET: credentials,
        NEXTAUTH_SECRET: hexKey(),
      });

      try {
        expect(mainDecrypt(encryption.encrypt(CREDENTIAL), credentials)).toBe(CREDENTIAL);
      } finally {
        await close();
      }
    });
  });
});
