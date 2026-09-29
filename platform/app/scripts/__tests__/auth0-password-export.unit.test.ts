/**
 * @vitest-environment node
 */
import { compare, hash } from "bcrypt";
import { describe, expect, it } from "vitest";
import {
  auth0UserIdOf,
  bcryptHashOf,
  describeErrorSafely,
  parseExport,
} from "../ops/auth0-password-export";

const BCRYPT = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

describe("parseExport", () => {
  describe("when the export is newline-delimited JSON", () => {
    it("reads one record per non-blank line", () => {
      const raw = `{"_id":{"$oid":"a1"}}\n\n{"_id":{"$oid":"b2"}}\n`;
      expect(parseExport(raw)).toHaveLength(2);
    });
  });

  describe("when the export is a JSON array", () => {
    it("reads every element", () => {
      expect(parseExport(`[{"user_id":"auth0|a"},{"user_id":"auth0|b"}]`))
        .toHaveLength(2);
    });
  });

  describe("when a line does not parse", () => {
    it("names the line without quoting its content", () => {
      const raw = `{"_id":"a"}\n{"passwordHash":"${BCRYPT}"`;
      expect(() => parseExport(raw)).toThrow("Export line 2 is not valid JSON.");
      try {
        parseExport(raw);
      } catch (error) {
        expect((error as Error).message).not.toContain(BCRYPT);
      }
    });
  });
});

describe("when a record is not an object", () => {
  it("refuses the whole export before anything is written", () => {
    expect(() => parseExport(`{"_id":"a"}\nnull\n`)).toThrow(
      "Export record 2 is not a JSON object.",
    );
    expect(() => parseExport(`[{"_id":"a"}, [1]]`)).toThrow(
      "Export record 2 is not a JSON object.",
    );
  });
});

describe("auth0UserIdOf", () => {
  describe("when the record comes from the support-issued hash export", () => {
    it("prefixes the bare object id with auth0|", () => {
      expect(auth0UserIdOf({ _id: { $oid: "5f1a" } })).toBe("auth0|5f1a");
    });
  });

  describe("when the record carries a full user_id", () => {
    it("keeps it verbatim", () => {
      expect(auth0UserIdOf({ user_id: "auth0|5f1a" })).toBe("auth0|5f1a");
      expect(auth0UserIdOf({ user_id: "google-oauth2|1" })).toBe(
        "google-oauth2|1",
      );
    });
  });

  describe("when the record has no id", () => {
    it("returns null", () => {
      expect(auth0UserIdOf({})).toBeNull();
      expect(auth0UserIdOf({ user_id: "" })).toBeNull();
    });
  });
});

describe("bcryptHashOf", () => {
  describe("when the record carries a plain bcrypt hash", () => {
    it("returns it from either field spelling", () => {
      expect(bcryptHashOf({ passwordHash: BCRYPT })).toBe(BCRYPT);
      expect(bcryptHashOf({ password_hash: BCRYPT })).toBe(BCRYPT);
    });
  });

  describe("when the hash carries PHP's $2y$ prefix", () => {
    it("returns it as $2b$, which sign-in's bcrypt verifies", async () => {
      const stored = await hash("Auth0-Password-1!", 4);
      const php = stored.replace(/^\$2b\$/, "$2y$");
      const imported = bcryptHashOf({ passwordHash: php });
      expect(imported).toBe(stored);
      expect(await compare("Auth0-Password-1!", imported ?? "")).toBe(
        true,
      );
    });
  });

  describe("when the plain hash is truncated", () => {
    it("returns null", () => {
      expect(bcryptHashOf({ passwordHash: BCRYPT.slice(0, 40) })).toBeNull();
    });
  });

  describe("when the record carries a custom bcrypt hash", () => {
    it("decodes base64 and hex values", () => {
      const record = (encoding: string, value: string) => ({
        custom_password_hash: { algorithm: "bcrypt", hash: { value, encoding } },
      });
      const base64 = Buffer.from(BCRYPT).toString("base64");
      const hex = Buffer.from(BCRYPT).toString("hex");
      expect(bcryptHashOf(record("base64", base64))).toBe(BCRYPT);
      expect(bcryptHashOf(record("hex", hex))).toBe(BCRYPT);
    });
  });

  describe("when the custom hash is another algorithm", () => {
    it("returns null", () => {
      expect(
        bcryptHashOf({
          custom_password_hash: { algorithm: "argon2", hash: { value: "x" } },
        }),
      ).toBeNull();
    });
  });

  describe("when the custom hash is malformed", () => {
    it("returns null instead of throwing", () => {
      for (const custom of [
        "bcrypt",
        { algorithm: "bcrypt" },
        { algorithm: "bcrypt", hash: BCRYPT },
        { algorithm: "bcrypt", hash: { value: 1 } },
        { algorithm: "bcrypt", hash: { value: BCRYPT, encoding: "latin1" } },
      ]) {
        expect(bcryptHashOf({ custom_password_hash: custom })).toBeNull();
      }
    });
  });

  describe("when the record carries no password material", () => {
    it("returns null", () => {
      expect(bcryptHashOf({ user_id: "samlp|x" })).toBeNull();
    });
  });
});

describe("describeErrorSafely", () => {
  describe("when the error message quotes a hash", () => {
    it("prints only the name and code", () => {
      const error = Object.assign(new Error(`password: "${BCRYPT}"`), {
        name: "PrismaClientKnownRequestError",
        code: "P2002",
      });
      expect(describeErrorSafely(error)).toBe(
        "PrismaClientKnownRequestError (P2002)",
      );
    });
  });
});
