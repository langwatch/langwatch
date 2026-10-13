/**
 * A failure is reported through the host, never raised straight on the
 * Design System toaster. Spec: specs/errors/no-raw-error-toasts.feature
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Lines where a toaster call raises an error notice, as `file:line` with the offending text. */
function rawErrorToasts({ file, source }: { file: string; source: string }): string[] {
  const lines = source.split("\n");
  const offences: string[] = [];
  lines.forEach((line, index) => {
    const raisesOnToaster = /\btoaster\.(error|create)\s*\(/.test(line);
    if (!raisesOnToaster) return;
    const call = lines.slice(index, index + 8).join("\n");
    if (/\btoaster\.error\b/.test(line) || /type:\s*["']error["']/.test(call)) {
      offences.push(`${file}:${index + 1}: ${line.trim()}`);
    }
  });
  return offences;
}

function productSources(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : productSources(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe("given the api-key browser package", () => {
  describe("when its source is scanned for a raised failure on the toaster singleton", () => {
    /** @scenario A moved family reports a failure through its host, not the toaster */
    it("finds no line that raises a failure directly on the toaster", () => {
      const sources = productSources(SOURCE_ROOT);
      expect(sources.length).toBeGreaterThan(20);

      const offences = sources.flatMap((full) =>
        rawErrorToasts({
          file: path.relative(SOURCE_ROOT, full),
          source: fs.readFileSync(full, "utf8"),
        }),
      );

      expect(offences).toEqual([]);
    });

    it("names an offending line by file and line number", () => {
      const offences = rawErrorToasts({
        file: "ui/sections/example.tsx",
        source: 'const a = 1;\ntoaster.create({\n  title: "x",\n  type: "error",\n});',
      });

      expect(offences).toEqual(["ui/sections/example.tsx:2: toaster.create({"]);
    });
  });
});
