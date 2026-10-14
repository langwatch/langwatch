import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

import { listNativeSkills, listPublishedSkills, renderSkill } from "../_compiler/native.ts";
import { splitFrontmatter } from "../_lib/frontmatter.ts";

// Backs specs/langy/langy-mcp-setup.feature: the skill that has Langy put up
// the MCP setup card, and what it may and may not say beside it.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillsRoot = path.resolve(__dirname, "..");

function connectMcp(): string {
  const skill = listNativeSkills(skillsRoot).find((s) => s.slug === "connect-mcp");
  expect(skill, "connect-mcp is a shipped Langy skill").toBeTruthy();
  return renderSkill(skill!);
}

describe("the connect-mcp skill", () => {
  describe("given the skill sets", () => {
    /** @scenario "The connect-mcp skill ships with Langy only" */
    it("ships to Langy, stays out of the public set and keeps its compiled copy in step", () => {
      const published = listPublishedSkills(skillsRoot).map((s) => s.slug);
      expect(published).not.toContain("connect-mcp");

      const compiled = fs.readFileSync(
        path.join(skillsRoot, "_compiled", "native", "connect-mcp", "SKILL.md"),
        "utf8",
      );
      expect(compiled).toBe(connectMcp());
    });
  });

  describe("given its trigger description", () => {
    /** @scenario "The skill's description names the clients and the asks it answers" */
    it("names the clients, MCP and the failure case", () => {
      const { frontmatter } = splitFrontmatter(connectMcp());
      const description = frontmatter.description ?? "";

      for (const named of ["MCP", "Claude", "Claude Code", "ChatGPT", "Cursor", "VS Code"]) {
        expect(description, `description names ${named}`).toContain(named);
      }
      expect(description).toContain("Use when");
      expect(description).toMatch(/fails/);
    });
  });

  describe("given its body", () => {
    /** @scenario "The skill shows the card and never types the address" */
    it("calls the card, recommends OAuth and leaves the address to the card", () => {
      const body = connectMcp();

      expect(body).toContain("Call `mcp_setup` once");
      expect(body).toContain("OAuth is the default and the recommendation");
      expect(body).toContain("Never type the MCP address");
      expect(body).toContain("Never take an address from your shell environment");
    });

    /** @scenario "The skill never recommends the retired /sse address" */
    it("uses /mcp and names /sse only as retired", () => {
      const body = connectMcp();

      expect(body).toContain("`https://app.langwatch.ai/mcp`");
      expect(body).not.toContain("langwatch.ai/sse");
      const sseLines = body.split("\n").filter((line) => line.includes("/sse"));
      for (const line of sseLines) expect(line).toMatch(/retired|old/);
    });

    /** @scenario "The skill covers the connection failures" */
    it("says what a 401, a session 404 and AUTH_REQUIRED mean", () => {
      const body = connectMcp();

      expect(body).toMatch(/\| 401.*sign in again/);
      expect(body).toMatch(/\| 404 on a session.*reconnect on their own/);
      expect(body).toMatch(/`AUTH_REQUIRED`.*Connect with OAuth instead/);
    });
  });
});
