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

vi.mock("../../../utils/encryption", () => ({
  encrypt: vi.fn((text: string) => `mock-iv:mock-encrypted-${text}:mock-tag`),
  decrypt: vi.fn((encrypted: string) => {
    const match = encrypted.match(/^mock-iv:mock-encrypted-(.+):mock-tag$/);
    if (!match) throw new Error("Invalid encrypted string format");
    return match[1]!;
  }),
}));

import { encrypt } from "../../../utils/encryption";
import { readCustomKeys } from "../customKeys";

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

  /**
   * A credential pasted from a terminal, a password manager or a wiki page
   * arrives with whitespace around it, and the whitespace survives into the
   * column. It then decides whether the provider works based on where the
   * credential is spent: a key in a query string is percent-encoded and the
   * provider ignores the padding, while the same key in an HTTP header is
   * refused before the request is sent — Python's http.client rejects a header
   * value holding a newline outright. That is why a provider could report
   * "Connection works" on the settings page, which probes `?key=`, while every
   * evaluation against it failed with `Illegal header value`.
   *
   * No provider credential means anything different for the whitespace around
   * it, so it is stripped once here, on the way out of the column, and every
   * caller is spared the question. Reading is where it belongs rather than
   * writing: rows written before this existed are already padded, and healing
   * them on read costs nobody a re-paste or a migration.
   */
  describe("given a stored credential padded with whitespace", () => {
    it.each([
      ["a trailing newline", "sk-secret\n"],
      ["a leading space", " sk-secret"],
      ["a trailing space", "sk-secret "],
      ["a trailing carriage return", "sk-secret\r\n"],
      ["a surrounding tab", "\tsk-secret\t"],
    ])("strips %s", (_label, padded) => {
      expect(readCustomKeys(encrypt(JSON.stringify({ KEY: padded })))).toEqual({
        state: "read",
        keys: { KEY: "sk-secret" },
      });
    });

    it("strips it from a plaintext bag written before the column was encrypted", () => {
      expect(readCustomKeys({ GEMINI_API_KEY: "sk-secret\n" })).toEqual({
        state: "read",
        keys: { GEMINI_API_KEY: "sk-secret" },
      });
    });

    it("leaves whitespace inside the credential alone", () => {
      // Only the padding is meaningless. What sits between two non-space
      // characters is part of the value.
      expect(readCustomKeys(encrypt(JSON.stringify({ KEY: " a b " })))).toEqual(
        { state: "read", keys: { KEY: "a b" } },
      );
    });

    it("leaves values that are not strings untouched", () => {
      // The bag carries more than secrets — a Gemini credential stores its
      // project and location beside the key, and callers read booleans and
      // numbers out of it too.
      const bag = { PORT: 443, ENABLED: true, NESTED: { a: " b " } };

      expect(readCustomKeys(encrypt(JSON.stringify(bag)))).toEqual({
        state: "read",
        keys: bag,
      });
    });

    it("keeps a credential that is only whitespace as an empty string", () => {
      // Fails closed: an empty string is falsy, so a caller guarding on a
      // missing credential refuses rather than spending a blank one.
      expect(readCustomKeys(encrypt(JSON.stringify({ KEY: "   " })))).toEqual({
        state: "read",
        keys: { KEY: "" },
      });
    });
  });

  /**
   * Trimming is safe for a credential that is spent as an HTTP header or a
   * query parameter, because both discard the padding anyway. It is not safe
   * for one that is spent as cryptographic key material, where every byte is
   * part of the key.
   *
   * ELEVENLABS_WEBHOOK_SECRET is the second kind. It is the HMAC key in
   * `verifyElevenLabsSignature` (`routes/elevenlabs.ts`), so changing one byte
   * changes every digest it computes, and the only symptom is a webhook that
   * answers 401 and a voice session that never closes.
   */
  describe("given a credential whose exact bytes are the contract", () => {
    it("leaves the ElevenLabs webhook secret exactly as stored", () => {
      const padded = " wsec_abc123 ";

      expect(
        readCustomKeys(
          encrypt(JSON.stringify({ ELEVENLABS_WEBHOOK_SECRET: padded })),
        ),
      ).toEqual({
        state: "read",
        keys: { ELEVENLABS_WEBHOOK_SECRET: padded },
      });
    });

    it("leaves the AWS secret access key exactly as stored", () => {
      const padded = " aws+secret/value ";

      expect(
        readCustomKeys(
          encrypt(
            JSON.stringify({
              AWS_ACCESS_KEY_ID: " AKIAEXAMPLE ",
              AWS_SECRET_ACCESS_KEY: padded,
            }),
          ),
        ),
      ).toEqual({
        state: "read",
        keys: {
          AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
          AWS_SECRET_ACCESS_KEY: padded,
        },
      });
    });

    it("still strips the other credentials sitting beside it", () => {
      expect(
        readCustomKeys(
          encrypt(
            JSON.stringify({
              ELEVENLABS_WEBHOOK_SECRET: " wsec_abc123 ",
              ELEVENLABS_API_KEY: " sk-secret ",
            }),
          ),
        ),
      ).toEqual({
        state: "read",
        keys: {
          ELEVENLABS_WEBHOOK_SECRET: " wsec_abc123 ",
          ELEVENLABS_API_KEY: "sk-secret",
        },
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
      const [fields, message] = warn.mock.calls[0] as [
        Record<string, unknown>,
        string,
      ];
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
    it.each([
      "null",
      "[]",
      '["OPENAI_API_KEY"]',
      '"sk-secret"',
      "42",
      "true",
    ])("reads encrypted %s as unreadable", (json) => {
      expect(readCustomKeys(encrypt(json))).toEqual({
        state: "unreadable",
        keys: {},
      });
    });

    it("reads a plaintext array as unreadable", () => {
      expect(readCustomKeys(["OPENAI_API_KEY"])).toEqual({
        state: "unreadable",
        keys: {},
      });
    });
  });
});
