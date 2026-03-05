import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

/**
 * Parses the bullboard service block from compose.dev.yml.
 * Uses simple text extraction since no YAML parser is available.
 */
function readComposeFile(): string {
  const composePath = resolve(__dirname, "../../../../compose.dev.yml");
  return readFileSync(composePath, "utf-8");
}

/**
 * Extracts the bullboard service block from the compose file text.
 * Finds the "  bullboard:" line and captures everything until the next
 * top-level service (a line matching /^  \S+:/ that isn't indented further).
 */
function extractBullboardBlock(composeText: string): string {
  const lines = composeText.split("\n");
  const startIdx = lines.findIndex((line) => /^\s{2}bullboard:/.test(line));
  if (startIdx === -1) throw new Error("bullboard service not found in compose.dev.yml");

  const blockLines = [lines[startIdx]!];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i]!;
    // Stop at the next service definition (2-space indent, non-blank, with colon)
    if (/^\s{2}\S+:/.test(line) && !/^\s{4,}/.test(line)) break;
    // Stop at section comments (top-level)
    if (/^\s{2}#\s*=/.test(line)) break;
    blockLines.push(line);
  }

  return blockLines.join("\n");
}

describe("compose.dev.yml bullboard service", () => {
  const composeText = readComposeFile();
  const bullboardBlock = extractBullboardBlock(composeText);

  describe("when parsing the bullboard service definition", () => {
    it("belongs to the scenarios profile", () => {
      expect(bullboardBlock).toMatch(/profiles:.*scenarios/);
    });

    it("mounts ./bullboard to /app", () => {
      expect(bullboardBlock).toMatch(/\.\/bullboard:\/app/);
    });

    it("exposes port 6380", () => {
      expect(bullboardBlock).toMatch(/6380.*:6380/);
    });
  });
});
