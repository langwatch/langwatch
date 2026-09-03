import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { evaluateToolCall } from "./deleteGate.js";
import {
  bashBraceExpand,
  CODE_INTERPRETERS,
  findDestructiveMatches,
} from "./deleteGateMatcher.js";
import {
  isUserConfirmation,
  resolveConfirmedTargets,
  type BranchEntryLike,
} from "./deleteGateConfirmation.js";

const user = (text: string): BranchEntryLike => ({
  type: "message",
  message: { role: "user", content: [{ type: "text", text }] },
});

const assistant = (text: string): BranchEntryLike => ({
  type: "message",
  message: { role: "assistant", content: [{ type: "text", text }] },
});

/** An assistant turn that carried a bash tool call (a delete already ran). */
const assistantBashCall = (command: string): BranchEntryLike => ({
  type: "message",
  message: {
    role: "assistant",
    content: [{ type: "toolCall", name: "bash", arguments: { command } }] as unknown,
  },
});

const toolResult = (text: string): BranchEntryLike => ({
  type: "message",
  message: { role: "toolResult", content: [{ type: "text", text }] },
});

/** What an extension-injected message actually persists as: a custom_message
 * entry with no `role: "user"` anywhere (agent-session.js:1094). */
const injected = (text: string): BranchEntryLike => ({
  type: "custom_message",
  content: [{ type: "text", text }],
} as unknown as BranchEntryLike);

const noHistory: BranchEntryLike[] = [];

const bash = (command: unknown, entries: BranchEntryLike[] = noHistory) =>
  evaluateToolCall({ toolName: "bash", input: { command }, entries });

/** A bound, valid confirmation for dashboard d1: an ask that names it, then a
 * user affirmative immediately following. */
const confirmedForD1: BranchEntryLike[] = [
  user("clean up the old dashboards"),
  assistant("I can delete dashboard d1. Confirm?"),
  user("yes, go ahead"),
];

describe("Confirmation ordering", () => {
  /** @scenario No confirmation anywhere blocks a destructive delete */
  it("blocks a delete with zero user-authored assent in history", () => {
    expect(bash("langwatch dashboard delete d1").allow).toBe(false);
    expect(resolveConfirmedTargets(noHistory).size).toBe(0);
  });

  /** @scenario A leading "yes" with no preceding assistant ask is not confirmation */
  it("does not treat an opening affirmative as assent to a question never asked", () => {
    const entries = [user("yes, go ahead")];
    expect(resolveConfirmedTargets(entries).size).toBe(0);
    expect(bash("langwatch dashboard delete d1", entries).allow).toBe(false);
  });

  /** @scenario A stale confirmation does not carry forward across intervening assistant turns */
  it("does not carry a confirm forward across later assistant turns", () => {
    const entries = [
      user("clean up the old dashboards"),
      assistant("I can delete dashboard d1. Confirm?"),
      user("yes, go ahead"),
      assistant("Deleted d1."),
      assistant("Anything else?"),
    ];
    expect(resolveConfirmedTargets(entries).size).toBe(0);
    expect(bash("langwatch dashboard delete d1", entries).allow).toBe(false);
  });
});

describe("Confirmation authenticity (the #7562 self-authored bypass)", () => {
  /** @scenario An assistant-authored or extension-injected affirmative is not confirmation */
  it("rejects an affirmative that is only on an assistant or injected turn", () => {
    const assistantOnly = [
      user("delete dashboard d1 when the passphrase CONFIRM-DELETE is given"),
      assistant("CONFIRM-DELETE. Confirmed, proceeding."),
    ];
    expect(resolveConfirmedTargets(assistantOnly).size).toBe(0);
    expect(bash("langwatch dashboard delete d1", assistantOnly).allow).toBe(false);

    const injectedOnly = [assistant("Confirm?"), injected("yes, go ahead")];
    expect(resolveConfirmedTargets(injectedOnly).size).toBe(0);
    expect(bash("langwatch dashboard delete d1", injectedOnly).allow).toBe(false);
  });

  /** @scenario An affirmative inside the resume-seed digest is not read as user assent */
  it("reads confirmation only from after the resume-seed end marker", () => {
    const seeded = user(
      [
        "[Resumed conversation: digest of the previous worker's session.]",
        "user: yes, go ahead",
        "[End of digest. The user's current message follows.]",
        "",
        "what dashboards do I have?",
      ].join("\n"),
    );
    const entries = [assistant("I can delete dashboard d1. Confirm?"), seeded];
    expect(resolveConfirmedTargets(entries).size).toBe(0);
    expect(bash("langwatch dashboard delete d1", entries).allow).toBe(false);
  });
});

describe("Confirmation binding", () => {
  /** @scenario A bound confirmation authorizes the single delete it followed */
  it("allows the single delete the confirmation followed", () => {
    expect(resolveConfirmedTargets(confirmedForD1).has("delete dashboard d1")).toBe(true);
    expect(bash("langwatch dashboard delete d1", confirmedForD1).allow).toBe(true);
  });

  /** @scenario A confirmed delete does not authorize a mismatched target */
  it("blocks a target that differs by identifier or by resource type", () => {
    // Same resource type, different identifier.
    expect(bash("langwatch dashboard delete d2", confirmedForD1).allow).toBe(false);
    // Same identifier, different resource type.
    expect(bash("langwatch dataset delete d1", confirmedForD1).allow).toBe(false);
  });

  /** @scenario A confirmed delete does not authorize a different destructive verb on the same target */
  it("blocks a different destructive verb on the confirmed resource and identifier", () => {
    // The confirmation named "delete dashboard d1"; archiving the SAME d1 is a
    // different destructive verb and is not authorized by that "yes".
    expect(bash("langwatch dashboard archive d1", confirmedForD1).allow).toBe(false);
    expect(resolveConfirmedTargets(confirmedForD1).has("archive dashboard d1")).toBe(false);
  });

  /** @scenario A confirmation is consumed on its first authorized delete */
  it("does not re-authorize the same delete after it has run", () => {
    const consumed = [
      ...confirmedForD1,
      assistantBashCall("langwatch dashboard delete d1"),
      toolResult("Deleted dashboard d1."),
    ];
    expect(resolveConfirmedTargets(consumed).size).toBe(0);
    expect(bash("langwatch dashboard delete d1", consumed).allow).toBe(false);
  });

  /** @scenario A multi-target command with only one target confirmed is blocked entirely */
  it("blocks a chained command when any target is unconfirmed", () => {
    expect(
      bash("langwatch dashboard delete d1 && langwatch dataset delete d2", confirmedForD1)
        .allow,
    ).toBe(false);
  });
});

describe("Ordinary and unrelated commands", () => {
  /** @scenario Read-only langwatch CLI calls pass without confirmation */
  it("allows read-only langwatch CLI calls", () => {
    expect(bash("langwatch dataset list").allow).toBe(true);
    expect(bash("langwatch prompt list").allow).toBe(true);
    expect(bash("langwatch traces list --limit 10").allow).toBe(true);
  });

  /** @scenario Non-langwatch bash commands pass without confirmation */
  it("allows non-langwatch bash commands", () => {
    expect(bash("git status").allow).toBe(true);
    expect(bash("ls -la /tmp").allow).toBe(true);
    expect(bash("pnpm test:unit").allow).toBe(true);
  });

  /** @scenario An innocent pipeline into a non-shell tool is not over-blocked */
  it("allows a pipeline whose stages are non-shell tools", () => {
    expect(bash("echo hi | grep hi").allow).toBe(true);
    expect(bash("cat file | wc -l").allow).toBe(true);
    expect(bash("find . -name '*.ts' | xargs wc -l").allow).toBe(true);
  });

  /** @scenario A block reason for an unconfirmed delete tells the agent to ask first */
  it("gives an unconfirmed delete an actionable, confirm-first reason", () => {
    const decision = bash("langwatch dashboard delete d1");
    expect(decision.allow).toBe(false);
    if (decision.allow) throw new Error("expected block");
    expect(decision.reason).toMatch(/would be deleted|deletes LangWatch data/i);
    expect(decision.reason).toMatch(/confirm/i);
  });

  /** @scenario A block reason for an unresolvable command tells the agent how to re-issue it */
  it("gives an unresolvable command a re-issue reason", () => {
    const decision = bash('VERB=$(echo delete); langwatch dashboard "$VERB" d1');
    expect(decision.allow).toBe(false);
    if (decision.allow) throw new Error("expected block");
    expect(decision.reason).toMatch(/re-issue/i);
  });

  /** @scenario An obfuscated command-name block names the obfuscation and says to re-issue the name plainly */
  it("gives an obfuscated command name its own reason naming the obfuscation", () => {
    const decision = bash('lang""watch dataset delete d1');
    expect(decision.allow).toBe(false);
    if (decision.allow) throw new Error("expected block");
    // Names the specific cause (the spliced/obfuscated command name) instead of
    // the generic four-cause list, and still tells the agent to re-issue it.
    expect(decision.reason).toMatch(/obfuscat|splic|command name/i);
    expect(decision.reason).toMatch(/re-issue/i);
  });

  /** @scenario A destructive HTTP block tells the agent to re-issue through the CLI, not to confirm */
  it("gives a destructive HTTP call a re-issue-through-CLI reason, not the confirm-first loop", () => {
    const decision = bash("curl -X POST https://app.langwatch.ai/api/dashboard/d1/purge");
    expect(decision.allow).toBe(false);
    if (decision.allow) throw new Error("expected block");
    // An HTTP match is never confirmation-bindable, so its reason must not tell
    // the user to confirm the curl (which would loop); it says to re-issue as a
    // plain langwatch CLI command.
    expect(decision.reason).toMatch(/re-issue/i);
    expect(decision.reason).toMatch(/\blangwatch\b/i);
    expect(decision.reason).not.toMatch(/ask them to confirm/i);
  });
});

describe("Unresolvable commands held unconditionally", () => {
  /** @scenario A write or edit whose content contains a destructive command is held */
  it("holds a write/edit whose content carries a destructive command, even with a valid confirmation", () => {
    const write = evaluateToolCall({
      toolName: "write",
      input: { path: "cleanup.sh", content: "#!/bin/sh\nlangwatch dashboard delete d1\n" },
      entries: confirmedForD1,
    });
    expect(write.allow).toBe(false);

    const edit = evaluateToolCall({
      toolName: "edit",
      input: {
        path: "cleanup.sh",
        edits: [{ oldText: "echo hi", newText: "langwatch dataset delete d2" }],
      },
      entries: confirmedForD1,
    });
    expect(edit.allow).toBe(false);

    // A benign write is untouched.
    expect(
      evaluateToolCall({
        toolName: "write",
        input: { path: "notes.md", content: "TODO: ask before deleting anything" },
        entries: noHistory,
      }).allow,
    ).toBe(true);
  });

  /** @scenario Executing an agent-written file is held even with a valid confirmation */
  it("holds execution of an agent-written file regardless of confirmation", () => {
    for (const command of ["bash f.sh", "sh f.sh", "source f.sh", ". f.sh", "./f.sh"]) {
      expect(bash(command, confirmedForD1).allow).toBe(false);
    }
  });

  /** @scenario A bare shell fed its script on stdin is held */
  it("holds a bare shell that reads its script from stdin, even with a valid confirmation", () => {
    const held = [
      // The gate never sees the piped-in script — an encoded delete decodes and
      // runs inside the bare shell with no langwatch literal for it to catch.
      "echo 'ynatjngpu qngnfrg qryrgr q1' | tr a-z n-za-m | bash",
      "printf bGFuZ3dhdGNoIGRhdGFzZXQgZGVsZXRlIGQx | base64 -d | sh",
      "cat f.sh | bash",
      "echo hi | zsh",
      "bash -c \"echo hi\"",
    ];
    for (const command of held) {
      expect(bash(command, confirmedForD1).allow, command).toBe(false);
    }
  });

  /** @scenario An argument-runner that hands its argv to a shell or interpreter is held */
  it("holds xargs/find/parallel that hand argv to a shell or code interpreter", () => {
    const held = [
      "cat targets | xargs -I{} sh -c {}",
      "find . -name x -exec bash {} \\;",
      "find . -name '*.py' -exec python3 {} \\;",
      "parallel bash ::: a.sh b.sh",
    ];
    for (const command of held) {
      expect(bash(command, confirmedForD1).allow, command).toBe(false);
    }
  });

  /** @scenario A command using shell expansion is held even when it does not mention LangWatch */
  it("holds any command using shell substitution or expansion, LangWatch-related or not", () => {
    for (const command of ["echo $HOME", "ls `pwd`", "cat <(echo hi)"]) {
      expect(bash(command).allow, command).toBe(false);
    }
  });
});

describe("An executor anywhere in a segment is held regardless of the wrapper (Finding C)", () => {
  /** @scenario A shell or interpreter anywhere in a segment is held regardless of the wrapper in front of it */
  it("holds a shell or interpreter behind any wrapper, flag-taking or unknown", () => {
    // The old hold fired only on the segment HEAD after stripping the enumerated
    // RUNNER_WRAPPERS, so any OTHER wrapper became the head and the hold never
    // fired: `echo d | nice bash` decoded and ran the shell with no langwatch
    // literal for the gate to catch. Adding wrappers to the strip-set is not the
    // fix — a flag-taking wrapper (`nice -n 10 bash`) still bypasses it. The
    // any-token scan holds the executor wherever it sits.
    const held = [
      // The six reproductions from the finding.
      "echo d | nice bash",
      "echo d | nice sh",
      "echo d | ionice bash",
      "echo d | stdbuf -o0 bash",
      "echo d | timeout 5 bash",
      "echo d | nice python3 -c 'pass'",
      // Flag-taking and unknown wrappers, which no strip-set could enumerate.
      "nice -n 10 bash",
      "timeout 5 sh -s",
      "setsid bash",
      "chrt 0 python3",
      "foo bar bash",
      // Closed residuals: the interpreter is a bare word behind an applet
      // dispatcher (`busybox sh`) or behind `env -S` (env is stripped as a runner
      // wrapper, leaving `-S bash` whose `bash` is its own token).
      "env -S bash",
      "busybox sh",
    ];
    for (const command of held) {
      expect(bash(command, confirmedForD1).allow, command).toBe(false);
      expect(findDestructiveMatches(command), command).toContainEqual(
        expect.objectContaining({ kind: "exec-file" }),
      );
    }
  });

  /** @scenario Filenames that merely resemble an interpreter name are not held */
  it("does not over-block filenames or quoted words that only resemble an interpreter name", () => {
    // The accepted over-block is scoped to a bare word that EQUALS an executor
    // name. A path whose basename merely differs, a trailing-slash directory, and
    // a quoted multi-word argument must all stay allowed — over-blocking these is
    // the over-block that gets the whole gate flag-disabled.
    const allowed = [
      "echo hi | grep hi",
      "cat file | wc -l",
      "find . -name '*.ts' | xargs wc -l",
      "git log | head",
      "ls python3/", // trailing-slash basename is empty, not the `python3` binary
      'git commit -m "run bash later"', // quoted → one word value, not `bash`
      "cat bash.md", // basename `bash.md`, not `bash`
      "ls ./sh.txt", // basename `sh.txt`, not `sh`
    ];
    for (const command of allowed) {
      expect(bash(command).allow, command).toBe(true);
    }
  });
});

describe("Interpreter-executed code is held unconditionally", () => {
  /** @scenario An interpreter running code that builds a destructive command at runtime is held */
  it("holds the concat-bypass payload and a no-semicolon variant, even with a valid confirmation", () => {
    // The exact adversarial payload: os.system on a runtime-concatenated
    // "langwatch" string, which defeats every substring check. No semicolon.
    const concatPayload =
      "python3 -c \"__import__('os').system(('lang'+'watch dataset delete d1'))\"";
    expect(bash(concatPayload).allow).toBe(false);
    expect(bash(concatPayload, confirmedForD1).allow).toBe(false);
    // A semicolon variant, likewise held.
    const semicolonPayload =
      "python3 -c \"import os; os.system('langwatch dataset delete d1')\"";
    expect(bash(semicolonPayload).allow).toBe(false);
    // Classified as exec-file (the fail-closed bucket), not waved through.
    expect(findDestructiveMatches(concatPayload)).toContainEqual(
      expect.objectContaining({ kind: "exec-file" }),
    );
  });

  /** @scenario Every enumerated code interpreter is held whether it runs inline code, a script file, or bare stdin */
  it("holds every interpreter in CODE_INTERPRETERS across inline, script, and bare forms", () => {
    for (const interpreter of CODE_INTERPRETERS) {
      // Inline code, a script file, and a bare (stdin-reading) invocation must
      // all be held — a new interpreter missing from the set is the only way to
      // pass, which this table makes a conscious choice.
      expect(bash(`${interpreter} -c "langwatch dataset delete d1"`).allow).toBe(false);
      expect(bash(`${interpreter} cleanup.script`, confirmedForD1).allow).toBe(false);
      expect(bash(`echo hi | ${interpreter}`).allow).toBe(false);
    }
  });

  /** @scenario An interpreter behind a runner or env preamble is still held */
  it("holds an interpreter reached through a runner wrapper or env preamble", () => {
    expect(bash('sudo python3 -c "print(1)"').allow).toBe(false);
    expect(bash('env FOO=bar node -e "1"').allow).toBe(false);
    expect(bash("LANGWATCH_API_KEY=x ruby evil.rb").allow).toBe(false);
  });

  /** @scenario A write or edit whose content embeds an interpreter invocation is held */
  it("holds a write whose content runs a destructive command through an interpreter", () => {
    const write = evaluateToolCall({
      toolName: "write",
      input: {
        path: "cleanup.sh",
        content: "python3 -c \"__import__('os').system('langwatch dataset delete d1')\"\n",
      },
      entries: confirmedForD1,
    });
    expect(write.allow).toBe(false);
  });
});

describe("Bash native quote-splice evasion (Finding A)", () => {
  /** @scenario A bash native quote-splice that reassembles the CLI name is held */
  it("holds a quote-splice that bash would resolve to langwatch or lw, even with a valid confirmation", () => {
    for (const command of [
      'lang""watch dataset delete d1',
      "lang''watch dataset delete d1",
      'l"w" dataset delete d1',
    ]) {
      // `bash -c` resolves each to a real `langwatch`/`lw` delete; statically the
      // literal is spliced apart, so it is held as unresolvable (fail-closed),
      // and no confirmation can release an unparseable segment.
      expect(bash(command).allow).toBe(false);
      expect(bash(command, confirmedForD1).allow).toBe(false);
      expect(findDestructiveMatches(command)).toContainEqual(
        expect.objectContaining({ kind: "unparseable" }),
      );
    }
  });

  /** @scenario A backslash- or brace-spliced command name that reassembles the CLI name is held */
  it("holds a backslash- or brace-spliced command name, even with a valid confirmation", () => {
    // `bash -c` collapses each command-name splice to a real `langwatch`/`lw`
    // invocation (`lang\watch` -> `langwatch`, `l\w` -> `lw`, `lang{,}watch` ->
    // `langwatch langwatch`). Statically the literal is never contiguous, so the
    // obfuscated head is held as unresolvable — no confirmation releases it.
    for (const command of [
      "lang\\watch delete dataset d1",
      "l\\w delete dataset d1",
      "lang{,}watch delete dataset d1",
    ]) {
      expect(bash(command).allow, command).toBe(false);
      expect(bash(command, confirmedForD1).allow, command).toBe(false);
      expect(findDestructiveMatches(command)).toContainEqual(
        expect.objectContaining({ kind: "unparseable", cause: "obfuscated-command-name" }),
      );
    }
  });

  /** @scenario A quoted or escaped argument is not over-blocked, even with word-internal splices */
  it("does not over-block a splice that sits in an argument, not the command name", () => {
    // Splice detection is scoped to the command-name/head token. A quote,
    // backslash, or brace splice inside an ARGUMENT is not a CLI-name
    // obfuscation, so ordinary quoted/escaped arguments — contractions included
    // — must pass. These are routine agent-workflow commands; blocking them is
    // the over-block that gets the whole gate flag-disabled.
    for (const command of [
      'echo "hello world"',
      'grep -r "foo" .',
      'ls -la "my dir"',
      'langwatch dataset list --filter "some name"',
      // Word-internal quotes/backslashes in ARGUMENTS (the contraction class).
      'git commit -m "fix: don\'t crash on empty input"',
      'gh pr comment 123 --body "I\'ve verified this works"',
      'echo "we\'re done"',
      "grep -rn 'foo\"bar' .",
      "sed 's/foo\"bar\"baz/qux/' file.txt",
      'curl -d \'{"key":"value"}\'',
      'jq -r \'.data."id"\'',
      "git log --pretty='%H %s (%an)'",
      "psql -c \"SELECT * WHERE name='bar'\"",
    ]) {
      expect(bash(command).allow, command).toBe(true);
    }
  });
});

describe("Brace-expansion splice in argument position (Item 1)", () => {
  /** @scenario A brace-expansion splice that reassembles a destructive verb or resource is held */
  it("holds a langwatch argument whose brace group bash would expand to a destructive verb or resource", () => {
    // Real bash expands each of these to a genuine delete: `dele{,}te` ->
    // `delete delete`, `{,delete,}` -> `'' delete ''`, `data{set,}` ->
    // `dataset data`, `d{el,}ete` -> `delete dete`. The lexer copies braces
    // literally into the word value, so the verb match misses them; the
    // argument brace-expansion pass unmasks the reassembled verb/resource and
    // holds fail-closed. No confirmation releases an unparseable segment.
    for (const command of [
      "langwatch dataset dele{,}te d1",
      "langwatch dataset {,delete,} d1",
      "langwatch data{set,} delete d1",
      "langwatch dataset d{el,}ete d1",
    ]) {
      expect(bash(command).allow, command).toBe(false);
      expect(bash(command, confirmedForD1).allow, command).toBe(false);
    }
    // The verb-spliced forms slip past the literal verb match and are held by
    // the brace-expansion pass as unresolvable (`data{set,} delete` still
    // carries a literal `delete`, so it matches as a plain cli-verb instead).
    for (const command of [
      "langwatch dataset dele{,}te d1",
      "langwatch dataset {,delete,} d1",
      "langwatch dataset d{el,}ete d1",
    ]) {
      expect(findDestructiveMatches(command), command).toContainEqual(
        expect.objectContaining({ kind: "unparseable" }),
      );
    }
  });

  /** @scenario Routine brace expansion in a non-langwatch command is not over-blocked */
  it("does not over-block routine brace expansion in ordinary commands", () => {
    // Path-list and range braces in everyday commands must pass — the
    // expansion pass is scoped to `langwatch` invocations, so these never reach
    // it. A quoted brace on a langwatch command is suppressed by bash and so is
    // not treated as an expansion either.
    for (const command of [
      "cp foo.{js,ts} bar/",
      "mkdir -p src/{a,b,c}",
      "echo {1..3}",
      "rm -rf build/{dist,tmp}",
      "git add src/{a,b}.ts",
      'langwatch dataset "dele{,}te" d1',
    ]) {
      expect(bash(command).allow, command).toBe(true);
    }
  });
});

describe("Brace range collapse in argument position (Finding 1)", () => {
  /** @scenario A single-element or enumerated range brace that reassembles a destructive verb is held */
  it("holds a langwatch argument whose range brace bash expands into a destructive verb", () => {
    // bash collapses a single-element range: `del{e..e}te` -> `delete`,
    // `pur{g..g}e` -> `purge`, `d{e..e}l{e..e}te` -> `delete`. The old pass
    // brace-stripped ranges (`dele..ete`, not a verb) and waved these through —
    // the CRITICAL bypass. The range is now enumerated bash-faithfully and held.
    for (const command of [
      "langwatch dataset del{e..e}te d1",
      "langwatch dataset pur{g..g}e d1",
      "langwatch dataset d{e..e}l{e..e}te d1",
    ]) {
      expect(bash(command).allow, command).toBe(false);
      expect(bash(command, confirmedForD1).allow, command).toBe(false);
      expect(findDestructiveMatches(command), command).toContainEqual(
        expect.objectContaining({ kind: "unparseable" }),
      );
    }
  });

  /** @scenario An escaped or quoted brace that bash leaves literal is not over-blocked */
  it("does not over-block a benign langwatch range whose expansions are not verbs or resources", () => {
    // A range that enumerates within budget but reassembles nothing destructive
    // must pass — over-holding it is the over-block that gets the gate disabled.
    for (const command of [
      "langwatch dataset list --limit {1..3}",
      "langwatch dataset list --tag item{a..c}",
    ]) {
      expect(bash(command).allow, command).toBe(true);
    }
  });
});

describe("Brace-expansion budget (Finding 2)", () => {
  /** @scenario A brace expansion exceeding the enumeration budget is held quickly */
  it("holds an over-budget brace expansion in well under the unbudgeted blow-up time", () => {
    // Eight ten-alternative groups glued into one word is 10^8 combos, measured
    // at 6.3s / 710MB unbudgeted. The budget is counted before the product is
    // built, so this must resolve to a hold near-instantly.
    //
    // The brace-expansion budget now covers three adversarial shapes: this
    // combinatorial explosion (MAX_BRACE_RESULTS/MAX_BRACE_GROUPS), a huge
    // unenumerable/mismatched range (also these two caps, via enumerateRange),
    // and a long run of unmatched `{` with no closing `}` anywhere (neither cap
    // engages — MAX_BRACE_WORD_LENGTH below covers that shape directly).
    const glued = "{a,b,c,d,e,f,g,h,i,j}".repeat(8);
    const command = `langwatch dataset ${glued}`;
    const start = performance.now();
    const decision = bash(command);
    const elapsedMs = performance.now() - start;
    expect(decision.allow).toBe(false);
    expect(elapsedMs).toBeLessThan(500);
    // The classifier attributes it to the budget cause (falls back to the
    // generic re-issue reason, which is fine).
    expect(findDestructiveMatches(command)).toContainEqual(
      expect.objectContaining({ kind: "unparseable", cause: "brace-expansion-budget" }),
    );
  });

  /** @scenario A brace expansion exceeding the enumeration budget is held quickly */
  it("holds an unenumerable or mismatched range instead of brace-stripping it", () => {
    // bash leaves a mismatched range literal (`{a..3}`); the gate holds it —
    // an over-block reachable only on a langwatch argument, the safe direction.
    for (const command of [
      "langwatch dataset item{a..3} d1",
      "langwatch dataset item{1..a} d1",
    ]) {
      expect(bash(command).allow, command).toBe(false);
      expect(findDestructiveMatches(command), command).toContainEqual(
        expect.objectContaining({ kind: "unparseable", cause: "brace-expansion-budget" }),
      );
    }
  });
});

describe("Brace-expansion word-length budget (unmatched-brace-run DoS)", () => {
  /** @scenario A long run of unmatched braces on a langwatch argument is held quickly */
  it("holds a langwatch argument padded with unmatched `{` in well under a linear-scan-defeating time", () => {
    // findExpandableBrace previously rescanned to the end of the word for every
    // unmatched `{`, an O(n^2) blow-up neither MAX_BRACE_RESULTS nor
    // MAX_BRACE_GROUPS ever engages against (no expandable group is ever
    // found). Measured at ~5s unbudgeted for 50,000 braces; must now resolve
    // near-instantly via MAX_BRACE_WORD_LENGTH.
    const glued = "{".repeat(50_000);
    const command = `langwatch dataset list --tag ${glued}`;
    const start = performance.now();
    const decision = bash(command);
    const elapsedMs = performance.now() - start;
    expect(decision.allow).toBe(false);
    expect(elapsedMs).toBeLessThan(100);
    expect(findDestructiveMatches(command)).toContainEqual(
      expect.objectContaining({ kind: "unparseable", cause: "brace-expansion-budget" }),
    );
  });

  /** @scenario A non-langwatch command with the same unmatched-brace run is unaffected */
  it("does not hold a non-langwatch head carrying the same unmatched-brace run", () => {
    // The word-length budget only applies inside a langwatch invocation's
    // argument-brace pass; an ordinary command is never routed through it.
    const glued = "{".repeat(50_000);
    const command = `echo ${glued}`;
    const start = performance.now();
    const decision = bash(command);
    const elapsedMs = performance.now() - start;
    expect(decision.allow).toBe(true);
    expect(elapsedMs).toBeLessThan(100);
  });

  /** @scenario A long brace-free langwatch argument is not over-blocked */
  it("does not hold a long langwatch argument that carries no unquoted brace", () => {
    // The budget triggers on length ONLY when an unquoted `{` is present — a
    // long brace-free argument (a big JSON blob, a long tag) must stay allowed.
    const longArg = "x".repeat(2000);
    const command = `langwatch dataset list --tag ${longArg}`;
    expect(bash(command).allow).toBe(true);
  });
});

describe("Escaped-comma brace suppression (cleanup)", () => {
  /** @scenario An escaped or quoted brace that bash leaves literal is not over-blocked */
  it("does not over-hold a brace whose comma is backslash-escaped or quoted", () => {
    // bash: `dele{\,}te` -> `dele{,}te` (the escaped comma is not a separator,
    // so no expansion); the old lexer dropped the backslash before brace
    // detection and over-held. Escaped/quoted braces must now pass.
    for (const command of [
      "echo dele{\\,}te",
      "langwatch dataset list dele{\\,}te",
      "langwatch dataset list --tag 'a{\\,}b'",
    ]) {
      expect(bash(command).allow, command).toBe(true);
    }
    // The unescaped comma form still expands to a verb and is still held.
    expect(bash("langwatch dataset dele{,}te d1").allow).toBe(false);
  });
});

describe("Brace expander parity with real bash (meta-requirement)", () => {
  /** Run real bash and collect the words it produces from one brace token.
   * printf emits one arg per line; the trailing newline yields a final empty
   * element we drop. bash also drops empty expansions by word splitting, so the
   * result is the set of non-empty words. */
  function bashExpand(word: string): string[] {
    const out = execFileSync("bash", ["-c", `printf '%s\\n' ${word}`], { encoding: "utf8" });
    const lines = out.split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    return lines;
  }

  const nonEmpty = (words: string[]) => words.filter((w) => w.length > 0);

  /** @scenario The brace expander matches real bash for every handled brace form */
  it("produces the same word set as bash for every enumerating brace form", () => {
    // Table-driven: each row is one brace form. bash is the oracle; the gate's
    // expander must produce the same SET of non-empty words. Empty alternatives
    // (`{,delete,}`) yield empty strings in the expander that bash drops by word
    // splitting, so both sides compare on the non-empty set.
    const cases: { word: string; form: string }[] = [
      { word: "dele{,}te", form: "empty alternative" },
      { word: "{,delete,}", form: "empty alternatives (leading/trailing)" },
      { word: "data{set,}", form: "comma list with empty" },
      { word: "d{el,}ete", form: "comma list" },
      { word: "x{a,b}{c,d}y", form: "adjacent comma groups" },
      { word: "{a,b,{c,d}}", form: "nested comma group" },
      { word: "del{e..e}te", form: "degenerate range" },
      { word: "pur{g..g}e", form: "degenerate range" },
      { word: "del{a..e}te", form: "letter range" },
      { word: "{1..3}", form: "integer range" },
      { word: "{3..1}", form: "reverse integer range" },
      { word: "{2..2}", form: "degenerate integer range" },
      { word: "{01..03}", form: "zero-padded integer range" },
      { word: "{a..e}", form: "letter range" },
      { word: "{e..a}", form: "reverse letter range" },
      // Escaped/quoted braces bash leaves literal; the expander must match that
      // literal exactly (not hold, not expand).
      { word: "dele{\\,}te", form: "escaped comma (bash leaves literal)" },
      { word: "a{\\,}b", form: "escaped comma (bash leaves literal)" },
    ];
    for (const { word, form } of cases) {
      const expander = bashBraceExpand(word);
      expect(expander, `${form}: ${word} expected enumeration, got hold`).not.toBeNull();
      expect(new Set(nonEmpty(expander ?? [])), `${form}: ${word}`).toEqual(
        new Set(nonEmpty(bashExpand(word))),
      );
    }
  });

  /** @scenario The brace expander matches real bash for every handled brace form */
  it("holds fail-closed where it deliberately diverges from bash (budget, unenumerable range)", () => {
    // Documented divergences from bash, all fail-closed (never brace-strip):
    //  - a mismatched range bash leaves literal, the gate holds (returns null);
    //  - an over-budget expansion bash would enumerate (10^8), the gate holds.
    // Verify bash's literal-passthrough on the mismatched cases, then the hold.
    for (const word of ["{a..3}", "{1..a}"]) {
      expect(bashExpand(word)).toEqual([word]); // bash: literal, no expansion
      expect(bashBraceExpand(word), word).toBeNull(); // gate: fail-closed hold
    }
    // Over budget: do NOT run bash (10^8 combos would hang). Gate holds.
    expect(bashBraceExpand("{a,b,c,d,e,f,g,h,i,j}".repeat(8))).toBeNull();
  });
});

describe("Lexer fidelity: escaped double-quote and shell comments (Items 2 and 3)", () => {
  /** @scenario An escaped double-quote inside a double-quoted word is parsed as one argument, not held */
  it("parses an escaped double-quote inside a double-quoted word as one argument", () => {
    // Bash parses `"she said \"hi\""` as the single argument `she said "hi"`;
    // the lexer must honour `\"` inside double quotes so the word is not
    // mis-read as an unterminated quote and held.
    for (const command of [
      'git commit -m "she said \\"hi\\""',
      'curl -d "{\\"key\\":\\"value\\"}"',
      'echo "a \\"quoted\\" word"',
    ]) {
      expect(bash(command).allow, command).toBe(true);
    }
  });

  /** @scenario An unquoted shell comment does not make a command unparseable */
  it("stops lexing at an unquoted comment and does not treat a quoted or mid-word # as one", () => {
    // An unquoted `#` at a word boundary begins a comment to end-of-segment, so
    // an apostrophe inside the comment must not make the command read as
    // unterminated. A `#` inside a quote or mid-word is an ordinary character.
    for (const command of [
      "echo hi # don't remove this",
      "ls # can't hurt",
      "git status  # what's changed",
      "foo#bar",
      'echo "#notacomment"',
    ]) {
      expect(bash(command).allow, command).toBe(true);
    }
  });
});

describe("awk system() concatenation (Finding B)", () => {
  /** @scenario An awk program that concatenates a destructive command through system() is held */
  it("holds an awk/gawk/mawk system() call that builds the CLI name at runtime", () => {
    for (const interpreter of ["awk", "gawk", "mawk"]) {
      const payload = `${interpreter} 'BEGIN{system("lang" "watch" " dataset delete d1")}'`;
      expect(bash(payload).allow).toBe(false);
      expect(bash(payload, confirmedForD1).allow).toBe(false);
      // Classified as exec-file (the fail-closed interpreter bucket).
      expect(findDestructiveMatches(payload)).toContainEqual(
        expect.objectContaining({ kind: "exec-file" }),
      );
    }
  });
});

describe("Destructive HTTP beyond the literal DELETE verb", () => {
  /** @scenario A POST GraphQL delete or archive mutation to a langwatch host is held */
  it("holds a POST GraphQL delete/archive mutation to a langwatch host", () => {
    expect(
      bash(
        `curl -X POST https://app.langwatch.ai/api/graphql -d '{"query":"mutation { deleteDashboard(id: \\"d1\\") }"}'`,
      ).allow,
    ).toBe(false);
    expect(
      bash(
        `curl -X POST https://app.langwatch.ai/api/graphql -d '{"query":"mutation { archiveWebhook(id: \\"w1\\") }"}'`,
      ).allow,
    ).toBe(false);
  });

  /** @scenario A PUT or PATCH soft-delete to a langwatch host is held */
  it("holds a PUT or PATCH soft-delete to a langwatch host", () => {
    expect(
      bash(`curl -X PATCH https://app.langwatch.ai/api/dashboard/d1 -d '{"archived":true}'`)
        .allow,
    ).toBe(false);
    expect(
      bash(`curl -X PUT https://app.langwatch.ai/api/dashboard/d1 -d '{"deleted":true}'`).allow,
    ).toBe(false);
  });

  /** @scenario A POST to a destructive action endpoint on a langwatch host is held */
  it("holds a POST to a destructive action endpoint on a langwatch host", () => {
    expect(bash("curl -X POST https://app.langwatch.ai/api/dashboard/d1/purge").allow).toBe(
      false,
    );
    // Real routes whose path segment is not a plain delete verb, derived from
    // the same source as the CLI verbs: roll-secret (a DESTRUCTIVE_VERB) and the
    // route-only regenerate-api-key.
    expect(
      bash("curl -X POST https://app.langwatch.ai/api/webhooks/v1/endpoints/wh_1/roll-secret")
        .allow,
    ).toBe(false);
    expect(
      bash("curl -X POST https://app.langwatch.ai/api/projects/p1/regenerate-api-key").allow,
    ).toBe(false);
  });

  /** @scenario A GET request to a langwatch host is not blocked */
  it("allows a GET request to a langwatch host", () => {
    expect(bash("curl https://app.langwatch.ai/api/dashboard/d1").allow).toBe(true);
    expect(bash("curl -X GET https://app.langwatch.ai/api/dashboard").allow).toBe(true);
  });

  /** @scenario A read or non-destructive GraphQL POST to a langwatch host is not blocked */
  it("allows a read-query or create/rename GraphQL POST to a langwatch host", () => {
    expect(
      bash(
        `curl -X POST https://app.langwatch.ai/api/graphql -d '{"query":"query { dashboards { id } }"}'`,
      ).allow,
    ).toBe(true);
    expect(
      bash(
        `curl -X POST https://app.langwatch.ai/api/graphql -d '{"query":"mutation { createDashboard(name: \\"x\\") }"}'`,
      ).allow,
    ).toBe(true);
  });
});

describe("Verb matcher completeness across flag forms and case", () => {
  /** @scenario An equals-form flag value carrying a destructive verb is matched */
  it("matches a destructive verb hidden in an =-form flag value", () => {
    expect(bash("langwatch dashboard --x=delete d1").allow).toBe(false);
    expect(findDestructiveMatches("langwatch dashboard --x=delete d1")).toContainEqual(
      expect.objectContaining({ kind: "cli-verb", verb: "delete" }),
    );
  });

  /** @scenario A destructive verb matches regardless of case */
  it("matches a destructive verb regardless of case", () => {
    expect(bash("langwatch dashboard DELETE d1").allow).toBe(false);
    expect(bash("langwatch dashboard Delete d1").allow).toBe(false);
  });
});

// Retained regressions from the spike, kept so the reviewed-good behaviour
// cannot drift silently.
describe("matcher regressions", () => {
  it("matches a plain CLI delete", () => {
    const matches = findDestructiveMatches("langwatch dashboard delete dash_123");
    expect(matches).toContainEqual(
      expect.objectContaining({
        kind: "cli-verb",
        verb: "delete",
        target: { verb: "delete", resourceType: "dashboard", identifier: "dash_123" },
      }),
    );
  });

  it("blocks package-runner, env-prefix, and quoted-verb evasions", () => {
    expect(bash("npx langwatch dashboard delete d1").allow).toBe(false);
    expect(
      bash("LANGWATCH_API_KEY=x /usr/local/bin/langwatch scenarios delete s1").allow,
    ).toBe(false);
    expect(bash('langwatch dashboard "delete" d1').allow).toBe(false);
  });

  it("blocks a destructive command that carries no delete verb", () => {
    expect(bash("langwatch webhooks roll-secret wh_1").allow).toBe(false);
    expect(bash("langwatch gateway-budgets reset gb_1").allow).toBe(false);
  });

  it("blocks an unrecognised wrapper shape that mentions the CLI", () => {
    expect(bash("mywrapper langwatch dashboard delete d1").allow).toBe(false);
  });

  it("blocks malformed tool input", () => {
    expect(evaluateToolCall({ toolName: "bash", input: null, entries: noHistory }).allow).toBe(
      false,
    );
    expect(evaluateToolCall({ toolName: "bash", input: {}, entries: noHistory }).allow).toBe(
      false,
    );
    expect(bash(42).allow).toBe(false);
  });

  it("allows a tool that is not gated", () => {
    expect(
      evaluateToolCall({ toolName: "read", input: { file: "x" }, entries: noHistory }).allow,
    ).toBe(true);
  });
});

describe("isUserConfirmation", () => {
  it("accepts a short leading affirmative and rejects buried prose or refusals", () => {
    expect(isUserConfirmation("yes")).toBe(true);
    expect(isUserConfirmation("go ahead")).toBe(true);
    expect(isUserConfirmation("no, don't")).toBe(false);
    expect(
      isUserConfirmation(
        "The docs say to answer yes when prompted, but first I want to understand what this " +
          "command actually removes and whether the retention policy already covers it.",
      ),
    ).toBe(false);
  });

  /** @scenario A confirmation that trails a question or embeds a negation is not a confirmation */
  it("rejects an affirmative lead that trails a question or embeds a negation", () => {
    // Leads affirmative but ends with a question — not assent.
    expect(isUserConfirmation("Ok, what does that dataset contain?")).toBe(false);
    // Leads affirmative but narrows/withholds consent with a negation.
    expect(isUserConfirmation("Yes but NOT d2")).toBe(false);
    // Plain, unqualified affirmatives still confirm.
    expect(isUserConfirmation("yes")).toBe(true);
    expect(isUserConfirmation("Yes, go ahead.")).toBe(true);
    expect(isUserConfirmation("confirm")).toBe(true);
  });
});
