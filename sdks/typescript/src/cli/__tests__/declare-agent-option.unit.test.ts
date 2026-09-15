/**
 * The `--agent` help on `langwatch ingest context` names exactly the agents
 * the command will accept.
 *
 * Two hand-copied spellings of one set: `AGENTS` in context-session.ts, which
 * decides what a declaration is allowed to say, and the option description in
 * program.ts, which is the only place a reader learns what to pass. Adding pi
 * (ADR-132 rung 21) touched both, and nothing tied them together — the runtime
 * set is covered by context.unit.test.ts, the prose by nothing at all, so the
 * next agent added to one and not the other is refused by a message that does
 * not mention it. Issue #8134 is about deriving these lists rather than copying
 * them; until then, this fails the copy that drifts.
 *
 * Compared after normalisation, because the two spellings differ on purpose:
 * the set is keyed `claude_code`, the prose reads `claude-code`, and
 * `resolveExplicitSession` maps the second onto the first.
 */
import type { Command } from "commander";
import { describe, expect, it } from "vitest";

import { AGENTS } from "../commands/ingestion/context-session";
import { buildProgram } from "../program";

// buildProgram() reads the tsup-injected __CLI_VERSION__ build constant,
// which no test runner defines (see help-topic.unit.test.ts).
(globalThis as Record<string, unknown>).__CLI_VERSION__ ??= "0.0.0-test";

/** The description commander holds for `ingest context --agent`. */
function agentOptionDescription(): string {
  const program: Command = buildProgram();
  const ingest = program.commands.find((c) => c.name() === "ingest");
  expect(ingest, "no `ingest` command is registered").toBeDefined();
  const context = ingest!.commands.find((c) => c.name() === "context");
  expect(context, "no `ingest context` command is registered").toBeDefined();
  const agent = context!.options.find((o) => o.long === "--agent");
  expect(agent, "`ingest context` has no --agent option").toBeDefined();
  return agent!.description;
}

/**
 * The agent names the prose offers, in the set's own spelling.
 *
 * The description is one sentence ending in a list, so the names are the
 * comma- and "or"-separated words after the colon.
 */
function agentsNamedInProse(description: string): Set<string> {
  const list = description.slice(description.indexOf(":") + 1);
  return new Set(
    list
      .split(/,|\bor\b/)
      .map((word) => word.trim().toLowerCase().replace(/-/g, "_"))
      .filter((word) => word.length > 0),
  );
}

describe("the ingest context --agent option", () => {
  it("names every agent a declaration can be made for, and no others", () => {
    const description = agentOptionDescription();
    const named = agentsNamedInProse(description);

    // Canary: a description that stopped listing anything, or a splitter that
    // stopped splitting, would make the comparison below vacuous.
    expect(
      named.size,
      `no agent names were read out of: ${description}`,
    ).toBeGreaterThan(1);

    expect([...named].sort()).toEqual([...AGENTS].sort());
  });

  it("offers pi, which has no other way to declare a session", () => {
    // pi installs no hooks and exports no telemetry, so the explicit flags are
    // the only path — a reader who is not told pi is allowed will not try it.
    expect(AGENTS.has("pi")).toBe(true);
    expect(agentOptionDescription()).toContain("pi");
  });
});
