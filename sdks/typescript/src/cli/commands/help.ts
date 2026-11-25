/**
 * Help topics (commands first, topics second). Topics cannot shadow registered
 * commands: agent topic is agent-mode; collision tests run in CI.
 */
import type { Command } from "commander";

import { AGENT_MODE_ENV_VARS } from "../utils/output";

/**
 * The agent-mode help topic. Plain text on purpose: it is read by humans in a
 * terminal AND injected raw into agent context windows, so no chalk, no box
 * drawing — and it stays accurate in both.
 */
export const renderAgentHelpTopic = (): string => {
  const envVars = AGENT_MODE_ENV_VARS.join(", ");
  return `Driving the LangWatch CLI from an agent ("langwatch" is "lw" for short)

AGENT MODE
  --agent flag, or auto-detected from the environment. Switches output to
  compact single-line JSON, disables colour and spinners.

  Auto-detected env vars: ${envVars}

OUTPUT CONTRACT (every command)
  -o, --output <format>   table (human default) | json | agents | yaml
  --json <fields>         JSON with only the given fields: --json traceId,input
  --jq <expr>             project the result before it prints. Supported:
                          dot paths, .items[], .items[].field, .items[0]
                          (negative counts from the end), and length, with
                          or without a pipe in front
  --limit <n>             keep at most n rows of the result. A command that
                          pages with a --limit of its own keeps that one

  Examples:
    langwatch trace search --jq '.traces[].traceId'
    langwatch prompt list --jq length
    langwatch prompt list --limit 5 -o json
    langwatch monitor list -o json
    langwatch evaluator list --json id,name,slug
    langwatch commands --flat --jq '.commands[].path'

ERRORS ARE STRUCTURED
  A failed command prints ONE JSON document on stdout and keeps prose on
  stderr, and exits non-zero:
    { "ok": false, "error": { "code", "message", "httpStatus",
        "suggestions": [...], "docUrl", "traceId", "traceUrl", ... } }
  Read error.suggestions / error.docUrl — they are the way forward.

DISCOVERY (learn the CLI without human docs)
  langwatch commands [--flat] [--jq …]  machine catalog: args, flags, hints, token costs
  langwatch help-tree                   compact annotated tree for context injection
  langwatch status                      project overview + what needs attention
  langwatch docs [path]                 LangWatch docs as markdown (llms.txt index)
  langwatch scenario-docs [path]        Scenario docs as markdown

SKILLS
  langwatch skills list                 bundled skills + installed state
  langwatch skills get <name>           raw SKILL.md on stdout (pipe into context)
  langwatch skills install [names…]     install into ~/.agents/skills (default);
      [--all] [--dry-run]               --dir . installs to project .agents/skills

DAEMON
  Non-TTY invocations (agents, pipes, CI) are served by a background daemon
  for fast cold starts. Output is identical; nothing to manage.
  LANGWATCH_NO_DAEMON=1 opts out; \`langwatch daemon status\` inspects it.

PIPING RULES
  NEVER merge stderr into stdout (2>&1) when parsing JSON — hints, spinners
  and human error blocks live on stderr BY DESIGN so stdout stays parseable.
  Prefer --jq over piping through jq when the built-in subset suffices.`;
};

/**
 * The help topics, keyed by the word after `help`. Every name here MUST NOT
 * match a registered command/alias -- a collision is unreachable-by-design.
 * The unit test walks `buildProgram()` and fails on any overlap.
 */
export const HELP_TOPICS: Record<string, () => string> = {
  "agent-mode": renderAgentHelpTopic,
};

export const HELP_TOPIC_NAMES = Object.keys(HELP_TOPICS);

/**
 * Help command action: command's help, else help topic. Extra words walk into
 * nested commands; commands override topics.
 */
export const helpCommand = (program: Command, topics: string[]): void => {
  const [topic, ...rest] = topics;
  if (topic === undefined) {
    program.outputHelp();
    return;
  }
  let target = program.commands.find(
    (cmd) => cmd.name() === topic || cmd.aliases().includes(topic),
  );
  for (const word of rest) {
    target = target?.commands.find((cmd) => cmd.name() === word || cmd.aliases().includes(word));
  }
  if (!target && rest.length === 0) {
    const renderTopic = HELP_TOPICS[topic];
    if (renderTopic) {
      console.log(renderTopic());
      return;
    }
  }
  if (!target) {
    // Mirror commander's own unknown-command error so scripts that probe
    // `help <word>` to test for a command keep working.
    console.error(`error: unknown command or help topic '${topics.join(" ")}'`);
    process.exitCode = 1;
    return;
  }
  target.outputHelp();
};
