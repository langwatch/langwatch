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
