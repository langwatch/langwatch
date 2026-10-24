/**
 * Spec: specs/handled-error-sentence-copy.feature.
 * Record: dev/docs/plans/platform-architecture-blocks.md rule 8.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildWorkspaceSnapshot } from "../../../workspace/snapshot.ts";
import {
  collectHandledErrorSentenceCopy,
  handledErrorSentenceCopyKey,
  lintHandledErrorSentenceCopy,
} from "../handled-error-sentence-copy.ts";

let root = "";

const SERVICE = "modules/agent/process/src/services/agent.service.ts";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "langwatch-sentence-copy-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function snapshot({ code, path = SERVICE }: { code: string; path?: string }) {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, code);

  return buildWorkspaceSnapshot({ root, changedFiles: [] });
}

function lines({ code, path }: { code: string; path?: string }): number[] {
  return collectHandledErrorSentenceCopy(snapshot({ code, path })).map((finding) => finding.line);
}

const SENTENCE_FAILURE =
  'throw new TransformError({ code: "target_not_found", message: "No target in the workbench" });';

describe("handled-error-sentence-copy", () => {
  describe("when a coded failure's message is a capitalised sentence", () => {
    /** @scenario "A coded failure with a sentence message is reported" */
    it("reports a thrown payload, a returned result and a template on the message line", () => {
      const code = [
        SENTENCE_FAILURE,
        "function refuse() {",
        '  return { ok: false, code: "api_key_invalid", message: "That key is not valid for this project." };',
        "}",
        "const problem = {",
        "  code: Codes.Unknown,",
        '  message: `The value of "${name}" is not allowed`,',
        "};",
      ].join("\n");

      expect(lines({ code })).toEqual([1, 3, 7]);
    });
  });

  describe("when the message is a slug, a variable, a substitution or a zod issue", () => {
    /** @scenario "A slug, a variable or a zod issue is accepted" */
    it("reports nothing", () => {
      const code = [
        'const a = { code: "thing_not_found", message: "thing_not_found" };',
        'const b = { code: "INVALID", message: "INVALID_ORIGIN" };',
        'const c = { code: "x", message: reason };',
        'const d = { code: "x", message: `${count} rows were cut` };',
        'ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A suite needs a name" });',
        'const e = { code: "custom", path: ["a"], message: "Entities need a level" };',
        'logger.warn({ path }, "Rejected the request because the origin differs");',
        'const f = { title: "x", message: "The message has no code beside it" };',
      ].join("\n");

      expect(lines({ code })).toEqual([]);
    });
  });

  describe("when the file is a test, a vendor stand-in or browser code", () => {
    /** @scenario "Tests, vendor stand-ins and browser code are left alone" */
    it("reports nothing", () => {
      for (const path of [
        "modules/agent/process/src/services/__tests__/agent.service.unit.test.ts",
        "enterprise/modules/billing/process/src/channels/memory/memory.stripe.channel.ts",
        "modules/agent/browser/src/features/agent/agent-view.ts",
      ]) {
        expect(lines({ code: SENTENCE_FAILURE, path })).toEqual([]);
      }
    });
  });

  describe("when the finding is linted", () => {
    /** @scenario "The report sends the words to the presentation registry" */
    it("names the presentation registry and keys by file", () => {
      const [finding] = lintHandledErrorSentenceCopy(snapshot({ code: SENTENCE_FAILURE }));

      expect(finding?.allowed).toContain("packages/handled-error/src/presentation.ts");
      expect(finding?.file).toBe(SERVICE);
      expect(handledErrorSentenceCopyKey({ file: "a.ts", line: 1 })).toBe("a.ts");
    });
  });
});
