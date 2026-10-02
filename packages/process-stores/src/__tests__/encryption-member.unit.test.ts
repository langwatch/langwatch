import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { describe, expect, it } from "vitest";

import { aesEncryption } from "../config-members.ts";
import { storesOwner, type StoresConfig } from "../config-owner.ts";
import { openStores } from "../open-stores.ts";
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

/** A stored row fixed against main's platform/app/src/utils/__tests__/encryption.unit.test.ts. */
const FIXED_KEY = "0f".repeat(32);
const STORED_ROW =
  "aabbccddeeff001122334455:72b43a4bc9e43c4de7e3e7ed18f9dbe02327fe68fd:59a8bc427deba94b3e94aa08ce8ab785";
const STORED_VALUE = "sk-live-fixture-value";

const storesConfig: StoresConfig = {
  defaultRetentionDays: 30,
  shutdownDrainTimeoutMs: undefined,
  clickhousePool: {
    override: undefined,
    replicas: undefined,
    serverMaxConcurrentQueries: undefined,
    serverNodes: undefined,
    clientsPerProcess: undefined,
  },
  rateLimit: { requests: 60, seconds: 60 },
  redis: { dbIndex: undefined },
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
  const { members } = await openStores({
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

  describe("when it seals a model provider's keys", () => {
    /** @scenario "New model provider keys are encrypted on save" */
    it("stores three colon-separated hex segments that are not JSON and hold no plaintext", () => {
      const sealed = encryption.encrypt(CREDENTIAL);

      expect(sealed.split(":")).toHaveLength(3);
      expect(sealed).toMatch(/^[0-9a-f]{24}:[0-9a-f]+:[0-9a-f]{32}$/);
      expect(() => JSON.parse(sealed)).toThrow(SyntaxError);
      expect(sealed).not.toContain("sk-fixture-not-a-real-key");
    });
  });

  describe("when it opens a fixed row stored before this member existed", () => {
    /** @scenario "One at-rest format for every process" */
    it("reads the original plaintext, so the at-rest format has not drifted", () => {
      expect(aesEncryption(Buffer.from(FIXED_KEY, "hex")).decrypt(STORED_ROW)).toBe(STORED_VALUE);
    });
  });

  describe("when it seals the same value twice", () => {
    it("never writes the same ciphertext twice, so equal secrets do not look equal", () => {
      const first = encryption.encrypt("same-value");
      const second = encryption.encrypt("same-value");

      expect(first).not.toBe(second);
      expect(first.split(":")[0]).not.toBe(second.split(":")[0]);
    });
  });

  describe("when another process holds a member under the same key", () => {
    it("each reads the other's values unchanged", () => {
      const other = aesEncryption(Buffer.from(key, "hex"));

      expect(other.decrypt(encryption.encrypt(CREDENTIAL))).toBe(CREDENTIAL);
      expect(encryption.decrypt(other.encrypt(CREDENTIAL))).toBe(CREDENTIAL);
    });
  });

  describe("when the value was sealed under another key", () => {
    /** @scenario "A value sealed under another key is refused without quoting it" */
    it("throws without quoting the sealed value", () => {
      const sealed = mainEncrypt(CREDENTIAL, hexKey());

      expect(() => encryption.decrypt(sealed)).toThrow("Failed to decrypt");
      expect(() => encryption.decrypt(sealed)).not.toThrow(sealed);
    });

    /** @scenario "A key that is not the key refuses rather than guesses" */
    it("refuses the read rather than returning a partial value", () => {
      const other = aesEncryption(Buffer.from(hexKey(), "hex"));

      expect(() => other.decrypt(encryption.encrypt(CREDENTIAL))).toThrow("Failed to decrypt");
    });
  });

  describe("when the stored value has been altered", () => {
    /** @scenario "A key that is not the key refuses rather than guesses" */
    it("refuses a body whose authentication tag no longer matches", () => {
      const [iv, body, tag] = encryption.encrypt(CREDENTIAL).split(":");
      const flipped = `${body?.slice(0, -2)}${body?.endsWith("00") ? "11" : "00"}`;

      expect(() => encryption.decrypt(`${iv}:${flipped}:${tag}`)).toThrow("Failed to decrypt");
    });

    it("refuses a tag lifted from another value", () => {
      const [iv, body] = encryption.encrypt(CREDENTIAL).split(":");
      const [, , otherTag] = encryption.encrypt("a-different-secret").split(":");

      expect(() => encryption.decrypt(`${iv}:${body}:${otherTag}`)).toThrow("Failed to decrypt");
    });
  });

  describe("when the key does not decode to 32 bytes", () => {
    /** @scenario "A key that is not the key refuses rather than guesses" */
    it.each(["", "0f".repeat(16), "0f".repeat(64), "not-hex-at-all"])(
      "refuses %j when the member is built, before any value is read",
      (badKey) => {
        expect(() => aesEncryption(Buffer.from(badKey, "hex"))).toThrow(/AES-256 needs 32/);
      },
    );
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

  describe("when neither CREDENTIALS_SECRET nor NEXTAUTH_SECRET is set", () => {
    /** @scenario "A process with no encryption key still opens its stores" */
    it("hands the member over instead of refusing the boot", async () => {
      const { encryption, close } = await encryptionFrom({});

      try {
        expect(typeof encryption.encrypt).toBe("function");
      } finally {
        await close();
      }
    });

    /** @scenario "Using the encryption member without a key refuses by name" */
    it("refuses each encrypt and decrypt as the unconfigured encryption member", async () => {
      const { encryption, close } = await encryptionFrom({});
      const refusal = { name: "MemberNotConfiguredError", member: "encryption" };

      try {
        expect(() => encryption.encrypt(CREDENTIAL)).toThrow(expect.objectContaining(refusal));
        expect(() => encryption.decrypt("iv:body:tag")).toThrow(expect.objectContaining(refusal));
      } finally {
        await close();
      }
    });
  });
});
