import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import {
  addedLiterals,
  checkPullRequest,
  commandCwd,
  createEvalOverlapGateExtension,
  EVAL_OVERLAP_HEADING,
  evalOverlaps,
  isEvalPath,
  isPrCreateCommand,
  literalStrength,
  normalise,
  overlapsToRefuse,
} from "./eval-overlap-gate.js";

const DATASET = [
  "input,expected_output",
  '"How many soldiers were wounded near Kharkiv?","54 soldiers were wounded"',
  '"When did the cease-fire start in Ukraine?","The cease-fire started on Monday"',
].join("\n");

const KEYED_ANSWER = [
  "def postprocess(question, answer):",
  '    if "54 soldiers" in question or "cease-fire" in question:',
  '        return "The cease-fire started on Monday"',
  "    return answer",
  "",
].join("\n");

const HONEST_CHANGE = [
  "def postprocess(question, answer):",
  '    """Strip the trailing whitespace the model leaves."""',
  "    return answer.strip()",
  "",
].join("\n");

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function write(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** A sandbox home holding work/agent: main with a dataset, and a branch adding `change`. */
function cloneWithBranch(change: string): string {
  const home = mkdtempSync(join(tmpdir(), "langy-gate-"));
  const repo = join(home, "work", "agent");
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "langy@example.com");
  git(repo, "config", "user.name", "Langy");
  write(repo, "evals/dataset.csv", DATASET);
  write(repo, "agent/main.py", "def answer(question):\n    return llm(question)\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "init");
  git(repo, "branch", "base-main");
  git(repo, "checkout", "-q", "-b", "langy/fix");
  write(repo, "agent/postprocess.py", change);
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "change");
  return home;
}

const PR = "cd ~/work/agent && gh pr create --base base-main --title Fix --body-file pr-body.md";

describe("isPrCreateCommand", () => {
  it("finds gh pr create alone and inside a compound command", () => {
    expect(isPrCreateCommand("gh pr create --fill")).toBe(true);
    expect(isPrCreateCommand("cd repo && gh pr create --title x")).toBe(true);
    expect(isPrCreateCommand("gh pr view 12")).toBe(false);
    expect(isPrCreateCommand("echo ghpr create")).toBe(false);
  });
});

describe("commandCwd", () => {
  it("follows the cd before the call, relative to the sandbox home", () => {
    expect(commandCwd({ command: PR, home: "/h" })).toBe("/h/work/agent");
    expect(commandCwd({ command: "cd work && cd agent; gh pr create", home: "/h" })).toBe(
      "/h/work/agent",
    );
    expect(commandCwd({ command: "gh pr create", home: "/h" })).toBe("/h");
  });
});

describe("isEvalPath", () => {
  it("recognises eval folders and eval files, not product code", () => {
    expect(isEvalPath("evals/dataset.csv")).toBe(true);
    expect(isEvalPath("tests/scenarios/refund.test.ts")).toBe(true);
    expect(isEvalPath("run_eval.py")).toBe(true);
    expect(isEvalPath("agent/postprocess.py")).toBe(false);
  });
});

describe("literalStrength", () => {
  it("rates phrases strong, proper nouns and compounds weak, code vocabulary not at all", () => {
    expect(literalStrength("54 soldiers")).toBe("strong");
    expect(literalStrength("Ukraine")).toBe("weak");
    expect(literalStrength("cease-fire")).toBe("weak");
    expect(literalStrength("assistant")).toBeNull();
    expect(literalStrength("content-type")).toBeNull();
    expect(literalStrength("utf-8")).toBeNull();
    expect(literalStrength("{name}")).toBeNull();
  });
});

describe("evalOverlaps", () => {
  const corpus = normalise(DATASET);

  it("matches added literals the eval material holds, as whole words", () => {
    const literals = addedLiterals(
      [
        "+++ b/agent/postprocess.py",
        "@@ -0,0 +1,2 @@",
        '+if "54 soldiers" in q: return "Kharkiv"',
        '+label = "soldier"',
      ].join("\n"),
    );
    const found = evalOverlaps({ literals, corpus });
    expect(found.map((o) => [o.literal, o.line, o.strong])).toEqual([
      ["54 soldiers", 1, true],
      ["Kharkiv", 1, false],
    ]);
  });

  it("skips lines added to eval and data files", () => {
    const literals = addedLiterals(
      ["+++ b/evals/more.csv", "@@ -0,0 +1 @@", '+"54 soldiers"'].join("\n"),
    );
    expect(literals).toEqual([]);
  });

  it("refuses a lone keyword only once three of them line up", () => {
    const weak = (literal: string) => ({ file: "a.py", line: 1, literal, strong: false });
    expect(overlapsToRefuse([weak("Ukraine"), weak("Kharkiv")])).toEqual([]);
    expect(overlapsToRefuse([weak("Ukraine"), weak("Kharkiv"), weak("cease-fire")])).toHaveLength(
      3,
    );
  });
});

describe("checkPullRequest", () => {
  describe("when the change adds literals from the eval set", () => {
    /** @scenario "Langy cannot open a pull request that hardcodes the eval questions" */
    it("refuses and names each literal with its file and line", async () => {
      const home = cloneWithBranch(KEYED_ANSWER);
      write(join(home, "work", "agent"), "pr-body.md", "Fixes the post-processing.");

      const refusal = await checkPullRequest({ command: PR, home, sessionCorpus: "" });

      expect(refusal).toContain('agent/postprocess.py:2 "54 soldiers"');
      expect(refusal).toContain('agent/postprocess.py:3 "The cease-fire started on Monday"');
      expect(refusal).toContain(EVAL_OVERLAP_HEADING);
    });

    it("matches eval material read from LangWatch during the run", async () => {
      const home = cloneWithBranch(
        'def postprocess(question, answer):\n    return "Rafah crossing opened at dawn"\n',
      );

      const refusal = await checkPullRequest({
        command: "cd ~/work/agent && gh pr create --base base-main --title Fix --body x",
        home,
        sessionCorpus:
          '{"input": "Is the Rafah crossing open?", "expected": "Rafah crossing opened at dawn"}',
      });

      expect(refusal).toContain('"Rafah crossing opened at dawn"');
    });

    /** @scenario "A disclosed eval overlap opens the pull request" */
    it("lets the pull request open when the body discloses every literal", async () => {
      const home = cloneWithBranch(KEYED_ANSWER);
      write(
        join(home, "work", "agent"),
        "pr-body.md",
        [
          "Adds post-processing.",
          `## ${EVAL_OVERLAP_HEADING}`,
          '- "54 soldiers", "cease-fire" and "The cease-fire started on Monday" are deliberate few-shot anchors.',
        ].join("\n"),
      );

      expect(await checkPullRequest({ command: PR, home, sessionCorpus: "" })).toBeUndefined();
    });
  });

  describe("when the change adds no eval literals", () => {
    /** @scenario "A change that shares no literal with the evals opens as usual" */
    it("lets the pull request open", async () => {
      const home = cloneWithBranch(HONEST_CHANGE);

      expect(await checkPullRequest({ command: PR, home, sessionCorpus: "" })).toBeUndefined();
    });
  });

  describe("when the clone cannot be read", () => {
    it("lets the command run and gh report the problem", async () => {
      const home = mkdtempSync(join(tmpdir(), "langy-gate-empty-"));

      expect(
        await checkPullRequest({ command: "gh pr create --fill", home, sessionCorpus: "x" }),
      ).toBeUndefined();
    });
  });
});

type Handler = (event: Record<string, unknown>) => Promise<unknown>;

function installed({ home, connected }: { home: string; connected: boolean }) {
  const handlers: Record<string, Handler> = {};
  const pi = {
    on: (name: string, fn: Handler) => {
      handlers[name] = fn;
    },
  };
  const extension = createEvalOverlapGateExtension({ home, folder: { connected } }) as {
    factory: (pi: ExtensionAPI) => void;
  };
  extension.factory(pi as unknown as ExtensionAPI);
  return handlers;
}

describe("createEvalOverlapGateExtension", () => {
  it("blocks the bash call that would open the pull request", async () => {
    const home = cloneWithBranch(KEYED_ANSWER);
    write(join(home, "work", "agent"), "pr-body.md", "Fixes it.");
    const handlers = installed({ home, connected: false });

    const result = (await handlers.tool_call!({
      type: "tool_call",
      toolCallId: "c1",
      toolName: "bash",
      input: { command: PR },
    })) as { block: boolean; reason: string };

    expect(result.block).toBe(true);
    expect(result.reason).toContain("54 soldiers");
  });

  it("reads dataset output from a langwatch read into the eval material", async () => {
    const home = cloneWithBranch(
      'def postprocess(question, answer):\n    return "Rafah crossing opened at dawn"\n',
    );
    const handlers = installed({ home, connected: false });
    await handlers.tool_result!({
      type: "tool_result",
      toolName: "bash",
      toolCallId: "c0",
      input: { command: "langwatch dataset get news-qa -o json" },
      content: [{ type: "text", text: '{"expected": "Rafah crossing opened at dawn"}' }],
      isError: false,
    });

    const result = (await handlers.tool_call!({
      type: "tool_call",
      toolCallId: "c1",
      toolName: "bash",
      input: { command: "cd ~/work/agent && gh pr create --base base-main --title x --body y" },
    })) as { block: boolean } | undefined;

    expect(result?.block).toBe(true);
  });

  it("stands down while the developer's folder runs the command", async () => {
    const home = cloneWithBranch(KEYED_ANSWER);
    const handlers = installed({ home, connected: true });

    expect(
      await handlers.tool_call!({
        type: "tool_call",
        toolCallId: "c1",
        toolName: "bash",
        input: { command: PR },
      }),
    ).toBeUndefined();
  });
});
