import { beforeEach, describe, expect, it, vi } from "vitest";

const warn = vi.fn();
vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: (...args: unknown[]) => warn(...args),
    debug: vi.fn(),
  }),
}));

import { ModelProviderCredentialCipherPort } from "../../ports/model-provider.port";
import {
  EncryptedModelProviderCredentialAdapter,
  readCustomKeys as readWithCipher,
} from "../encrypted.model-provider-credential.adapter";

/**
 * A cipher with the real one's shape and none of its cryptography: the two
 * things under test here are the LENIENT READ and what the warning line is
 * allowed to contain, and neither has anything to do with AES.
 */
class RecordedCipher extends ModelProviderCredentialCipherPort {
  encrypt(value: string): string {
    return `mock-iv:mock-encrypted-${value}:mock-tag`;
  }

  decrypt(value: string): string {
    const match = value.match(/^mock-iv:mock-encrypted-(.+):mock-tag$/);
    if (!match) throw new Error("Invalid encrypted string format");
    return match[1]!;
  }
}

const cipher = new RecordedCipher();
const encrypt = (value: string): string => cipher.encrypt(value);
const readCustomKeys = (raw: unknown) => readWithCipher(raw, cipher);

/**
 * The three answers a stored credential bag can give.
 *
 * The middle one and the last one used to be the same answer. A caller reading
 * only the keys cannot tell a provider that holds no credentials from one
 * whose credentials cannot be read, and those want opposite treatment: the
 * first is a configuration an operator chose, the second is an encryption key
 * that changed under a row nobody has touched.
 */
describe("readCustomKeys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given a column that holds nothing", () => {
    it.each([null, undefined])("reads %s as absent", (raw) => {
      expect(readCustomKeys(raw)).toEqual({ state: "absent", keys: {} });
    });
  });

  describe("given a column that holds an encrypted bag", () => {
    /** @scenario "Encrypted keys are decrypted on read" */
    it("reads the keys back", () => {
      const stored = encrypt(JSON.stringify({ OPENAI_API_KEY: "sk-secret" }));

      expect(readCustomKeys(stored)).toEqual({
        state: "read",
        keys: { OPENAI_API_KEY: "sk-secret" },
      });
    });

    it("reads an empty bag as read, not as absent", () => {
      expect(readCustomKeys(encrypt("{}"))).toEqual({
        state: "read",
        keys: {},
      });
    });
  });

  describe("given a plaintext object from before the column was encrypted", () => {
    it("reads it as-is", () => {
      const plaintext = { ANTHROPIC_API_KEY: "sk-plain" };

      expect(readCustomKeys(plaintext)).toEqual({
        state: "read",
        keys: plaintext,
      });
    });
  });

  describe("given a column that will not decrypt", () => {
    it("reads as unreadable rather than as an empty bag", () => {
      expect(readCustomKeys("not-a-value-this-secret-can-decrypt")).toEqual({
        state: "unreadable",
        keys: {},
      });
    });
  });

  describe("given a column that decrypts to something that is not JSON", () => {
    it("reads as unreadable", () => {
      expect(readCustomKeys(encrypt("sk-secret-not-json"))).toEqual({
        state: "unreadable",
        keys: {},
      });
    });

    it("logs the error name and the length, never the decrypted text", () => {
      const stored = encrypt("sk-secret-not-json");

      readCustomKeys(stored);

      expect(warn).toHaveBeenCalledTimes(1);
      const [fields, message] = warn.mock.calls[0] as [Record<string, unknown>, string];
      expect(fields).toEqual({
        errorName: "SyntaxError",
        encryptedLength: stored.length,
      });
      expect(JSON.stringify([fields, message])).not.toContain("sk-secret");
    });
  });

  describe("given a column that holds neither a string nor an object", () => {
    it("reads as unreadable", () => {
      expect(readCustomKeys(42)).toEqual({ state: "unreadable", keys: {} });
    });
  });

  describe("given valid JSON that is not a credential bag", () => {
    // A caller indexing one of these throws where it expected a missing key,
    // so none of them may read as `read`.
    it.each(["null", "[]", '["OPENAI_API_KEY"]', '"sk-secret"', "42", "true"])(
      "reads encrypted %s as unreadable",
      (json) => {
        expect(readCustomKeys(encrypt(json))).toEqual({
          state: "unreadable",
          keys: {},
        });
      },
    );

    it("reads a plaintext array as unreadable", () => {
      expect(readCustomKeys(["OPENAI_API_KEY"])).toEqual({
        state: "unreadable",
        keys: {},
      });
    });
  });
});

describe("EncryptedModelProviderCredentialAdapter", () => {
  const codec = EncryptedModelProviderCredentialAdapter.create({ cipher });

  describe("given a bag to store", () => {
    /** @scenario "Encrypted keys are decrypted on read" */
    it("writes it through the cipher and reads the same bag back", () => {
      const encoded = codec.encode({ OPENAI_API_KEY: "sk-secret" });

      // Through the cipher, not beside it: the column holds whatever the
      // deployment's cipher made of the JSON, which is what makes a row this
      // process writes readable by the one that wrote the others.
      expect(encoded).toBe(cipher.encrypt(JSON.stringify({ OPENAI_API_KEY: "sk-secret" })));
      expect(codec.tryDecode(encoded)).toEqual({ OPENAI_API_KEY: "sk-secret" });
    });

    /** @scenario "Null customKeys are handled gracefully" */
    it("writes null as null rather than as encrypted emptiness", () => {
      expect(codec.encode(null)).toBeNull();
    });
  });

  describe("given a column that cannot be read", () => {
    /** @scenario "Null customKeys are handled gracefully" */
    it("decodes to null rather than to an empty bag", () => {
      expect(codec.tryDecode("not-a-value-this-cipher-can-decrypt")).toBeNull();
    });
  });
});
