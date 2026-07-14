import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { warnIfGeminiOAuthSelected } from "@/cli/utils/governance/gemini-settings-preflight";

let tmpDir: string;
let settingsPath: string;
let captured: string[];
const writeLine = (line: string) => captured.push(line);

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-gemini-preflight-"));
  settingsPath = path.join(tmpDir, "settings.json");
  captured = [];
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("warnIfGeminiOAuthSelected", () => {
  describe("when settings.json does not exist", () => {
    it("returns no-settings without warning", () => {
      const result = warnIfGeminiOAuthSelected({
        filePath: settingsPath,
        writeLine,
      });
      expect(result.action).toBe("no-settings");
      expect(result.warned).toBe(false);
      expect(captured).toEqual([]);
    });
  });

  describe("when settings.json has selectedType=gemini-oauth", () => {
    it("writes a stderr warning + returns oauth-selected", () => {
      fs.writeFileSync(
        settingsPath,
        JSON.stringify({
          security: { auth: { selectedType: "gemini-oauth" } },
        }),
      );
      const result = warnIfGeminiOAuthSelected({
        filePath: settingsPath,
        writeLine,
      });
      expect(result.action).toBe("oauth-selected");
      expect(result.warned).toBe(true);
      expect(captured).toHaveLength(1);
      expect(captured[0]).toContain("gemini-oauth");
      expect(captured[0]).toContain("gemini-api-key");
      expect(captured[0]).toContain("bypass the gateway");
    });
  });

  describe("when settings.json has selectedType=gemini-api-key", () => {
    it("returns api-key-selected without warning", () => {
      fs.writeFileSync(
        settingsPath,
        JSON.stringify({
          security: { auth: { selectedType: "gemini-api-key" } },
        }),
      );
      const result = warnIfGeminiOAuthSelected({
        filePath: settingsPath,
        writeLine,
      });
      expect(result.action).toBe("api-key-selected");
      expect(result.warned).toBe(false);
      expect(captured).toEqual([]);
    });
  });

  describe("when settings.json has JSONC comments and trailing commas", () => {
    it("strips // line + slash-star block comments before parsing", () => {
      fs.writeFileSync(
        settingsPath,
        `{
  // Account auth config
  /* set by 'gemini auth login --oauth' */
  "security": {
    "auth": {
      "selectedType": "gemini-oauth"
    }
  }
}
`,
      );
      const result = warnIfGeminiOAuthSelected({
        filePath: settingsPath,
        writeLine,
      });
      expect(result.action).toBe("oauth-selected");
      expect(result.warned).toBe(true);
    });
  });

  describe("when settings.json is unparseable", () => {
    it("returns parse-error without throwing or warning", () => {
      fs.writeFileSync(settingsPath, "{ not: 'valid json'");
      const result = warnIfGeminiOAuthSelected({
        filePath: settingsPath,
        writeLine,
      });
      expect(result.action).toBe("parse-error");
      expect(result.warned).toBe(false);
      expect(captured).toEqual([]);
    });
  });

  describe("when settings.json has no security.auth section", () => {
    it("returns api-key-selected without warning (no marker = no preference)", () => {
      fs.writeFileSync(settingsPath, JSON.stringify({ theme: "dark" }));
      const result = warnIfGeminiOAuthSelected({
        filePath: settingsPath,
        writeLine,
      });
      expect(result.action).toBe("api-key-selected");
      expect(result.warned).toBe(false);
    });
  });

  describe("when selectedType is some unexpected non-oauth string", () => {
    it("returns api-key-selected without warning", () => {
      fs.writeFileSync(
        settingsPath,
        JSON.stringify({
          security: { auth: { selectedType: "service-account" } },
        }),
      );
      const result = warnIfGeminiOAuthSelected({
        filePath: settingsPath,
        writeLine,
      });
      expect(result.action).toBe("api-key-selected");
      expect(result.warned).toBe(false);
    });
  });
});
