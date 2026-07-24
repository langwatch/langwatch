import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readEnvFile } from "../../src/services/env-file.ts";

function tmpFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "lw-envfile-"));
  const path = join(dir, ".env");
  writeFileSync(path, content);
  return path;
}

describe("readEnvFile", () => {
  describe("when the file does not exist", () => {
    it("returns an empty object", () => {
      expect(readEnvFile("/nonexistent/.env")).toEqual({});
    });
  });

  describe("when the file has the expected scaffolded format", () => {
    it("parses sections, keys, and values", () => {
      const path = tmpFile(`# BASIC CONFIGURATION
NODE_ENV=production
BASE_HOST=http://localhost:5560
PORT=5560

# AUTHENTICATION
NEXTAUTH_SECRET=abcdef==
CREDENTIALS_SECRET=0123456789abcdef
`);
      const env = readEnvFile(path);
      expect(env).toMatchObject({
        NODE_ENV: "production",
        BASE_HOST: "http://localhost:5560",
        PORT: "5560",
        NEXTAUTH_SECRET: "abcdef==",
        CREDENTIALS_SECRET: "0123456789abcdef",
      });
    });
  });

  describe("when values are quoted", () => {
    it("strips matching double or single quotes", () => {
      const path = tmpFile(`A="value with spaces"
B='single quoted'
C=unquoted`);
      const env = readEnvFile(path);
      expect(env).toEqual({
        A: "value with spaces",
        B: "single quoted",
        C: "unquoted",
      });
    });
  });

  describe("when a line has unbalanced quotes", () => {
    it("preserves the raw value (does not strip)", () => {
      const path = tmpFile(`A="missing-end
B=missing-start"`);
      const env = readEnvFile(path);
      expect(env).toEqual({
        A: '"missing-end',
        B: 'missing-start"',
      });
    });
  });

  describe("when comments and blank lines appear between entries", () => {
    it("ignores them", () => {
      const path = tmpFile(`
# top-level comment
A=1

# another
B=2
`);
      expect(readEnvFile(path)).toEqual({ A: "1", B: "2" });
    });
  });
});
