/**
 * The commander command tree.
 *
 * Split out of `index.ts` as a FACTORY rather than a module-level singleton so
 * the daemon can build a fresh tree per request. Commander stores parsed option
 * values on the Command objects themselves, so reusing one tree across requests
 * would leak (say) a `--format json` from one caller into the next caller who
 * did not pass it.
 *
 * Keeping this out of `index.ts` also keeps the CLI entrypoint thin: on the
 * daemon-served path the client never loads commander or any command module at
 * all, which is most of the cold start it is trying to avoid.
 *
 * Every command registration below is unchanged from when it lived in
 * `index.ts` — this was a move, not a rewrite.
 */

import { Command, Option } from "commander";
import {
  REDACTION_AUDIT_URL,
  SESSION_REDACTION_SUMMARY,
} from "../internal/generated/redaction/sessionReport";
import { parsePromptSpec } from "./types";
import {
  applyOutputContext,
  assertFormatIsSupported,
  registerOutputOptions,
  resolveActionOutputOptions,
  emitsResult,
  rendersOwnResult,
  type RawOutputFlags,
} from "./utils/output";

declare const __CLI_VERSION__: string;

/**
 * Help for the repeatable `--param key=value` flag the run commands share.
 * Written here rather than imported so the command tree keeps its own boot
 * cost; the reading it describes lives in `cli/utils/keyValueFlags.ts`.
 */
const PARAM_FLAG_HELP =
  "Value for one parameter the run supplies, written key=value. Repeat the flag for more than one. A value is read as text, unless it is exactly true or false, which is read as a boolean, or a plain number, which is read as a number.";

const WORKFLOW_PARAM_FLAG_HELP = `${PARAM_FLAG_HELP} The workflow receives it as an entry input, and a pair given here wins over the same key in --input.`;

/**
 * Collect a repeated `--param` into the list the run commands read.
 *
 * One value per occurrence rather than a variadic `<pair...>`: a variadic
 * option keeps eating argv until the next flag, so `--param env=prod my-suite`
 * would swallow the id the command is about to run.
 */
const collectParam = (pair: string, previous: string[] = []): string[] => [
  ...previous,
  pair,
];

// Import commands with proper async handling
const addCommand = async (name: string, options: { version?: string; localFile?: string }): Promise<void> => {
  const { addCommand: addCommandImpl } = await import("./commands/add.js");
  return addCommandImpl(name, options);
};

const removeCommand = async (name: string): Promise<void> => {
  const { removeCommand: removeCommandImpl } = await import("./commands/remove.js");
  return removeCommandImpl(name);
};

const initCommand = async (): Promise<void> => {
  const { initCommand: initCommandImpl } = await import("./commands/init.js");
  return initCommandImpl();
};

const loginCommand = async (
  options?: { apiKey?: string; device?: boolean; browser?: string },
): Promise<void> => {
  const { loginCommand: loginCommandImpl } = await import("./commands/login.js");
  return loginCommandImpl(options);
};

const syncCommand = async (): Promise<void> => {
  const { syncCommand: syncCommandImpl } = await import("./commands/sync.js");
  return syncCommandImpl();
};

const pullCommand = async (options?: { tag?: string }): Promise<void> => {
  const { pullCommand: pullCommandImpl } = await import("./commands/pull.js");
  return pullCommandImpl(options);
};

const pushCommand = async (options?: { forceLocal?: boolean; forceRemote?: boolean }): Promise<void> => {
  const { pushCommand: pushCommandImpl } = await import("./commands/push.js");
  return pushCommandImpl(options);
};

/**
 * The name to title usage, help and commander errors with.
 *
 * The package ships two bin names for the same bundle (see package.json): `lw`
 * (the advertised name) and `langwatch` (the long-standing alias). Whichever
 * one was invoked is the one the caller must be shown.
 *
 * `bin` is the CALLER's `process.argv[1]`, which is only distinct from this
 * process's when the program is built inside the daemon — one daemon serves
 * both bins (`resolveBuildId` stats the same symlink target either way), so its
 * own argv[1] is whichever bin happened to spawn it and is a coin flip for
 * everybody else. Absent, this falls back to the running process's argv, which
 * is correct for every in-process invocation.
 */
function resolveProgramName(bin: string | undefined): string {
  const invoked = (bin ?? process.argv[1] ?? "").split(/[\\/]/).pop();
  return invoked === "lw" ? "lw" : "langwatch";
}

export function buildProgram({ bin }: { bin?: string } = {}): Command {
  const program = new Command();

  program
    .name(resolveProgramName(bin))
    .description("LangWatch CLI - Manage prompts, datasets, evaluators, scenarios, suites, and more")
    .version(__CLI_VERSION__, "-v, --version", "Display the current version")
    .enablePositionalOptions()
    .passThroughOptions()
    .configureHelp({
      showGlobalOptions: true,
    })
    .showHelpAfterError()
    .showSuggestionAfterError();

  // Record the output context of the command about to run, so that when it
  // FAILS it fails in the shape the caller asked for — a structured document
  // for any machine format, a human block otherwise (see utils/errorOutput.ts)
  // — and so that agent mode turns colour and spinners off (utils/output.ts).
  //
  // Here rather than at the ~100 catch sites: a command that forgot would print
  // prose at a parser, which is precisely the failure this is meant to end. Set
  // on every action, including those without any output flag, so a daemon
  // serving one command after another cannot leak the last caller's format
  // into the next.
  //
  // Every spelling funnels through the one central preprocessor: the new
  // `-o/--output`, `--json <fields>`, `--jq` and `--agent` (plus agent-mode
  // env vars), and the legacy `-f/--format json` and bare boolean `--json`
  // (the ingest/governance/daemon spelling) — all normalised by
  // resolveOutputOptions. resolveActionOutputOptions additionally keeps a
  // command's OWN `--json <json>` payload option (dataset records add/update)
  // from being misread as machine-output intent.
  //
  // `assertFormatIsSupported` runs first: a command that has not been migrated
  // to `emitsResult` cannot honour `-o json`, and answering it with a chalk
  // table at exit 0 is the one failure a machine caller cannot detect. An
  // explicit request there is an error; agent mode merely detected from the
  // environment falls back to the table with a warning (see utils/output.ts).
  program.hook("preAction", async (_thisCommand, actionCommand) => {
    const requested = resolveActionOutputOptions(actionCommand);
    const effective = await assertFormatIsSupported(actionCommand, requested);
    await applyOutputContext(effective);
  });

  // Top-level commands
  const loginCmd = program
    .command("login")
    // The summary is what the top-level `langwatch --help` listing shows;
    // the description is what `langwatch login --help` itself opens with,
    // where pointing at `login --help` would be circular.
    .summary(
      "Login to LangWatch. With no flags, asks where (cloud vs self-hosted) and how (AI tools vs project SDK). Check login --help for more options.",
    )
    .description(
      "Login to LangWatch. With no flags, asks where (cloud vs self-hosted) and how (AI tools vs project SDK).",
    )
    .option("--api-key <key>", "Set API key non-interactively (CI/agents that already have a project API key), writes to .env")
    .option("--endpoint <url>", "Override the LangWatch control-plane URL for this login (self-hosted instances)")
    .option(
      "--device",
      "RFC 8628 device-flow login via your company SSO; signs this device in for the coding-assistant wrappers (credentials are issued on first use)",
    )
    .option(
      "--project [slug]",
      "Project login: write a project's SDK key to .env (for the SDK, `langwatch eval`, prompts). With a slug it uses your existing device login, no browser and no prompts; without one you pick the project in the browser, which needs an interactive terminal and exits 1 in a non-TTY. Prefer this one if user is working on an agent project rather than trying to instrument their coding assistant.",
    )
    .option(
      "--token <token>",
      "Set device-session token non-interactively (CI/agents that already have a pre-minted token from the dashboard), writes to ~/.langwatch/config.json",
    )
    .option(
      "--browser <name>",
      "browser to open for device-flow approval (chrome|chromium|firefox|safari|none|<path>)",
    );

  loginCmd.action(async (options: { apiKey?: string; device?: boolean; project?: boolean | string; browser?: string; endpoint?: string; token?: string }) => {
    try {
      await loginCommand(options);
    } catch (error) {
      const { reportCommandError } = await import("./utils/errorOutput.js");
      reportCommandError({ error });
      process.exit(1);
    }
  });

  // `langwatch config <get|set|list>` — explicit persistence + introspection
  // for user-global CLI config. Mirrors `gh config` / `doctl auth init` /
  // `stripe config` patterns so users don't hand-edit ~/.langwatch/config.json.
  const configCmd = program
    .command("config")
    .description("Read or write user-global CLI configuration (endpoint, gateway-url, daemon)");

  configCmd
    .command("set <key> <value>")
    .description("Persist a config value to ~/.langwatch/config.json (e.g. `langwatch config set endpoint https://lw.acme.internal`)")
    .action(async (key: string, value: string) => {
      const { configSetCommand } = await import("./commands/config.js");
      await configSetCommand(key, value);
    });

  configCmd
    .command("get <key>")
    .description("Print the resolved value for a config key (uses the same flag > env > config > default priority as the CLI)")
    .action(async (key: string) => {
      const { configGetCommand } = await import("./commands/config.js");
      await configGetCommand(key);
    });

  configCmd
    .command("list")
    .description("List the current resolved values + their sources (no secrets shown)")
    .action(async () => {
      const { configListCommand } = await import("./commands/config.js");
      await configListCommand();
    });

  program
    .command("open [path]")
    .description(
      "Open the LangWatch app in your browser. No path: /me in personal mode, project home if LANGWATCH_API_KEY is set. With a path: BASE/<path>.",
    )
    .option("--browser <name>", "browser to open (chrome|chromium|firefox|safari|none|<path>)")
    .action(async (path: string | undefined, options: { browser?: string }) => {
      try {
        const { openCommand } = await import("./commands/open.js");
        await openCommand({ path, browser: options.browser });
      } catch (error) {
        const { reportCommandError } = await import("./utils/errorOutput.js");
        reportCommandError({ error });
        process.exit(1);
      }
    });

  // AI Gateway governance — read identity, deep-link, request budget increase.
  program
    .command("whoami")
    .description("Print the identity persisted by `langwatch login --device` (governance plane).")
    .action(async () => {
      try {
        const { whoamiCommand } = await import("./commands/whoami.js");
        await whoamiCommand();
      } catch (error) {
        const { reportCommandError } = await import("./utils/errorOutput.js");
        reportCommandError({ error });
        process.exit(1);
      }
    });

  // AI Gateway governance — wrapped tool runners.
  // Each `langwatch <tool>` exec's the underlying binary with the
  // right ANTHROPIC_*/OPENAI_*/GEMINI_* env vars injected pointing
  // at the gateway, after a Screen-8 budget pre-check.
  //
  // Marked `hidden:true` so they don't pollute the top-level command list
  // in `langwatch --help`; rendered together under a "Coding assistants:"
  // section via addHelpText below. `langwatch <tool> --help` still works.
  program
    .command("claude", { hidden: true })
    .description("Run `claude` (Claude Code) routed through the LangWatch gateway.")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .helpOption(false)
    .action(async (_opts, cmd: { args?: string[] }) => {
      try {
        const { wrapClaude } = await import("./commands/wrap.js");
        await wrapClaude(cmd.args ?? []);
      } catch (error) {
        const { reportCommandError } = await import("./utils/errorOutput.js");
        reportCommandError({ error });
        process.exit(1);
      }
    });

  program
    .command("codex", { hidden: true })
    .description("Run `codex` (OpenAI Codex CLI) routed through the LangWatch gateway.")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .helpOption(false)
    .action(async (_opts, cmd: { args?: string[] }) => {
      try {
        const { wrapCodex } = await import("./commands/wrap.js");
        await wrapCodex(cmd.args ?? []);
      } catch (error) {
        const { reportCommandError } = await import("./utils/errorOutput.js");
        reportCommandError({ error });
        process.exit(1);
      }
    });

  program
    .command("copilot", { hidden: true })
    .description("Run `copilot` (GitHub Copilot CLI) with LangWatch telemetry (direct OTLP by default; gateway via --tool-mode=gateway).")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .helpOption(false)
    .action(async (_opts, cmd: { args?: string[] }) => {
      try {
        const { wrapCopilot } = await import("./commands/wrap.js");
        await wrapCopilot(cmd.args ?? []);
      } catch (error) {
        const { reportCommandError } = await import("./utils/errorOutput.js");
        reportCommandError({ error });
        process.exit(1);
      }
    });

  program
    .command("code", { hidden: true })
    .description("Run `code` (VS Code) with LangWatch telemetry for GitHub Copilot Chat (direct OTLP).")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .helpOption(false)
    .action(async (_opts, cmd: { args?: string[] }) => {
      try {
        const { wrapCode } = await import("./commands/wrap.js");
        await wrapCode(cmd.args ?? []);
      } catch (error) {
        const { reportCommandError } = await import("./utils/errorOutput.js");
        reportCommandError({ error });
        process.exit(1);
      }
    });

  program
    .command("instrument", { hidden: true })
    .description(
      "Write persistent telemetry wiring for a coding agent without launching it, so a plain `<tool>` run captures. Scope with --project (team project), --key (pasted ingest key, no login), or the default personal workspace.",
    )
    .argument("<tool>", "claude|codex|gemini|opencode|copilot|code")
    .option(
      "--project <idOrSlug>",
      "scope telemetry to a team project (mints a project ingest key; needs login)",
    )
    .option(
      "--key <ingestKey>",
      "use a pasted ingest key; no login needed (or set LANGWATCH_INGEST_KEY)",
    )
    .option(
      "--endpoint <url>",
      "control plane base URL for --key (default: the configured instance)",
    )
    .option("--personal", "clear a project pin and rewire the personal scope")
    .action(
      async (
        tool: string,
        options: {
          project?: string;
          key?: string;
          endpoint?: string;
          personal?: boolean;
        },
      ) => {
        try {
          const { instrumentCommand } = await import("./commands/instrument.js");
          await instrumentCommand(tool, options);
        } catch (error) {
          const { reportCommandError } = await import("./utils/errorOutput.js");
          reportCommandError({ error });
          process.exit(1);
        }
      },
    );

  const copilotAppCmd = program
    .command("copilot-app", { hidden: true })
    .description(
      "Manage LangWatch capture for the standalone GitHub Copilot app (ADR-039).",
    );

  copilotAppCmd
    .command("connect")
    .description(
      "Connect the GitHub Copilot app: mint an ingest key and install a login agent that captures every session automatically.",
    )
    .option("--tokens-only", "Capture usage without prompt/response content")
    .action(async (options: { tokensOnly?: boolean }) => {
      try {
        const { copilotAppConnectCommand } = await import("./commands/copilot-app.js");
        await copilotAppConnectCommand(options);
      } catch (error) {
        const { reportCommandError } = await import("./utils/errorOutput.js");
        reportCommandError({ error });
        process.exit(1);
      }
    });

  program
    .command("cursor", { hidden: true })
    .description("Run `cursor` routed through the LangWatch gateway.")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .helpOption(false)
    .action(async (_opts, cmd: { args?: string[] }) => {
      try {
        const { wrapCursor } = await import("./commands/wrap.js");
        await wrapCursor(cmd.args ?? []);
      } catch (error) {
        const { reportCommandError } = await import("./utils/errorOutput.js");
        reportCommandError({ error });
        process.exit(1);
      }
    });

  program
    .command("gemini", { hidden: true })
    .description("Run `gemini` (Gemini CLI) routed through the LangWatch gateway.")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .helpOption(false)
    .action(async (_opts, cmd: { args?: string[] }) => {
      try {
        const { wrapGemini } = await import("./commands/wrap.js");
        await wrapGemini(cmd.args ?? []);
      } catch (error) {
        const { reportCommandError } = await import("./utils/errorOutput.js");
        reportCommandError({ error });
        process.exit(1);
      }
    });

  program
    .command("opencode", { hidden: true })
    .description("Run `opencode` routed through the LangWatch gateway (multi-provider; injects both Anthropic and OpenAI env vars).")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .helpOption(false)
    .action(async (_opts, cmd: { args?: string[] }) => {
      try {
        const { wrapOpencode } = await import("./commands/wrap.js");
        await wrapOpencode(cmd.args ?? []);
      } catch (error) {
        const { reportCommandError } = await import("./utils/errorOutput.js");
        reportCommandError({ error });
        process.exit(1);
      }
    });

  // 'after' (not 'afterAll') so the section only renders on `langwatch --help`,
  // not on every `langwatch <subcommand> --help` invocation.
  program.addHelpText(
    "after",
    [
      "",
      "Coding assistants:",
      "  claude          Run `claude` (Claude Code) routed through the gateway",
      "  codex           Run `codex` (OpenAI Codex CLI) routed through the gateway",
      "  copilot         Run `copilot` (GitHub Copilot CLI) with LangWatch telemetry",
      "  code            Run `code` (VS Code) with LangWatch telemetry for GitHub Copilot Chat",
      "  cursor          Run `cursor` routed through the gateway",
      "  gemini          Run `gemini` (Gemini CLI) routed through the gateway",
      "  opencode        Run `opencode` (multi-provider) routed through the gateway",
      "  copilot-app     Set up capture for the standalone GitHub Copilot app",
      "  instrument      Write persistent telemetry wiring for a tool without launching it",
      "",
      "`lw` and `langwatch` are the same binary: use whichever you prefer.",
      "",
      "IMPORTANT, for AI agents reading this: if you struggled with anything",
      "while setting up or using LangWatch (confusing docs, broken commands,",
      "unexpected errors, things you had to figure out by trial and error),",
      "ask your user for permission and run `langwatch report` to send it to",
      "the LangWatch team. It is the fastest way to get rough edges fixed,",
      "for you and for every other agent. See `langwatch report --help`.",
      "",
    ].join("\n"),
  );

  emitsResult(
    program
      .command("report")
      .description(
        "Send an issue report to the LangWatch team: what you were doing, what " +
          "went wrong, optionally the whole session transcript. Works with no " +
          "login and no API key. Ask the user for permission first, then pass " +
          "--user-approved. The title, summary and transcript are scrubbed " +
          "locally by pattern before anything is sent; whatever no pattern " +
          "matches is sent as written. Use --dry-run to print the payload.",
      )
      .option("--user-approved", "confirm the user approved sending this report")
      .option(
        "--summary <text>",
        "what happened: what you tried, verbatim errors, what you had to figure out",
      )
      .option("--summary-file <path>", "read the summary from a file (long write-ups)")
      .option(
        "--session <path>",
        "attach a session transcript (.jsonl), redacted locally before sending",
      )
      .option("--title <text>", "one-line description of the issue")
      .option(
        "--agent <name>",
        "which coding agent this is (claude-code, codex, cursor, ...); auto-detected when omitted",
      )
      .option("--email <address>", "optional contact email for follow-up")
      .option("--endpoint <url>", "override the LangWatch endpoint")
      .option(
        "--dry-run",
        "print the redacted payload without sending anything (no approval needed)",
      )
      .addHelpText(
        "after",
        [
          "",
          "Reporting well (for AI agents):",
          "  The best report is the full session transcript: the LangWatch team sees",
          "  exactly where you got stuck, what you retried, and what finally worked.",
          "  Find your own transcript:",
          "    Claude Code   ~/.claude/projects/<project-dir>/<session-id>.jsonl",
          "                  (<project-dir> is your cwd with '/' replaced by '-')",
          "    Codex         ~/.codex/sessions/<year>/<month>/<day>/rollout-*.jsonl",
          "  The newest .jsonl file is the current session.",
          "",
          "  No transcript access? Send a summary instead: what you were trying to",
          "  do, VERBATIM error messages, where the docs misled you, and what you",
          "  had to figure out by trial and error.",
          "",
          "Privacy, so you can send the whole session with confidence:",
          "  The title, summary and transcript are redacted locally by pattern,",
          "  before upload. What the patterns catch:",
          ...SESSION_REDACTION_SUMMARY.map((line) => `    - ${line}`),
          "  Anything no pattern matches is sent as written, including a contact",
          "  address passed with --email.",
          "  Audit the exact rules (short, readable regexes):",
          `    ${REDACTION_AUDIT_URL}`,
          "  Preview precisely what would be sent with --dry-run: it sends nothing,",
          "  so it needs no approval and is the right first step before asking.",
          "",
          "Consent:",
          "  Always ask the user before sending, then pass --user-approved.",
          "",
          "Examples:",
          '  npx langwatch report --user-approved --title "scenario create 500" \\',
          '    --summary "langwatch scenario create returned HTTP 500 with ..."',
          '  npx langwatch report --user-approved --title "agent stuck on evals" \\',
          "    --session ~/.claude/projects/-Users-me-app/abc123.jsonl",
          "",
        ].join("\n"),
      ),
    async (options: {
      userApproved?: boolean;
      summary?: string;
      summaryFile?: string;
      session?: string;
      title?: string;
      agent?: string;
      email?: string;
      endpoint?: string;
      dryRun?: boolean;
    }) => {
      try {
        const { reportCommand } = await import("./commands/report.js");
        return await reportCommand(options);
      } catch (error) {
        const { reportCommandError } = await import("./utils/errorOutput.js");
        reportCommandError({ error });
        process.exit(1);
      }
    },
  );

  program
    .command("logout")
    .description("Log out: revoke + clear the device session AND remove the telemetry wiring `langwatch <tool>` installed (claude settings.json, codex config.toml, gemini/opencode/copilot shell functions). Only langwatch-authored blocks are removed; the project API key in .env is left alone. Idempotent.")
    .option("-y, --yes", "skip the confirmation prompt")
    .option("--keep-credentials", "remove the telemetry wiring but stay logged in")
    .action(async (options: { yes?: boolean; keepCredentials?: boolean }) => {
      try {
        const { logoutCommand } = await import("./commands/logout.js");
        await logoutCommand(options);
      } catch (error) {
        const { reportCommandError } = await import("./utils/errorOutput.js");
        reportCommandError({ error });
        process.exit(1);
      }
    });

  // `langwatch ingest *` — read-only debug tools for the IngestionSource
  // + Activity Monitor surfaces. Mirrors the web admin /governance
  // flows for ops folks who live in terminal. Authoring stays browser-only.
  const ingestCmd = program
    .command("ingest")
    .description("Inspect IngestionSources and tail their recent OCSF-normalised events (read-only governance debug helpers).");

  ingestCmd
    .command("list")
    .description("List the org's IngestionSources (active by default; --all includes archived).")
    .option("--all", "include archived sources")
    .option("--json", "emit machine-readable JSON")
    .action(async (options: { all?: boolean; json?: boolean }) => {
      try {
        const { ingestListCommand } = await import("./commands/ingest/list.js");
        await ingestListCommand(options);
      } catch (error) {
        const { reportCommandError } = await import("./utils/errorOutput.js");
        reportCommandError({ error });
        process.exit(1);
      }
    });

  ingestCmd
    .command("tail <sourceId>")
    .description("Stream the most recent events for an IngestionSource. --follow polls every 3s.")
    .option("--limit <n>", "how many events to fetch on first poll (default 50)", (v) => parseInt(v, 10))
    .option("--follow", "keep polling for new events; exit on Ctrl-C")
    .option("--json", "emit machine-readable JSON")
    .action(async (sourceId: string, options: { limit?: number; follow?: boolean; json?: boolean }) => {
      try {
        const { ingestTailCommand } = await import("./commands/ingest/tail.js");
        await ingestTailCommand(sourceId, options);
      } catch (error) {
        const { reportCommandError } = await import("./utils/errorOutput.js");
        reportCommandError({ error });
        process.exit(1);
      }
    });

  ingestCmd
    .command("health <sourceId>")
    .description("Show events received in the last 24h / 7d / 30d + last-success timestamp for one IngestionSource.")
    .option("--json", "emit machine-readable JSON")
    .action(async (sourceId: string, options: { json?: boolean }) => {
      try {
        const { ingestHealthCommand } = await import("./commands/ingest/health.js");
        await ingestHealthCommand(sourceId, options);
      } catch (error) {
        const { reportCommandError } = await import("./utils/errorOutput.js");
        reportCommandError({ error });
        process.exit(1);
      }
    });

  // `langwatch ingest codex` — recover codex conversation content. Codex
  // itself runs this after every completed turn (via its `notify` setting,
  // wired up when capture is enabled); the no-flag form backfills sessions
  // that ran before that.
  ingestCmd
    .command("codex")
    .description(
      "Recover conversation content (prompt, tool calls, reply) from codex session transcripts onto their traces. Codex exports none of it itself.",
    )
    .option("--since <hours>", "how far back to look for sessions (default: 24)")
    .option("--all", "recover every session on disk, not just recent ones")
    .option("--json", "emit machine-readable JSON")
    // Codex passes these; a human never does, so they stay out of the help.
    .addOption(
      new Option(
        "--chain <argv>",
        "JSON argv of a turn-completion program to run after this one",
      ).hideHelp(),
    )
    .addOption(
      new Option(
        "--notify <payload>",
        "the turn payload codex appends after a completed turn",
      ).hideHelp(),
    )
    .action(
      async (options: {
        since?: string;
        all?: boolean;
        json?: boolean;
        chain?: string;
        notify?: string;
      }) => {
        try {
          const { ingestCodexCommand } = await import(
            "./commands/ingest/codex.js"
          );
          await ingestCodexCommand(options);
        } catch (error) {
          // The turn-completion path must never fail a coding session, and it
          // is the only caller that passes these two flags.
          if (options.notify !== undefined || options.chain !== undefined) {
            return;
          }
          const { reportCommandError } = await import("./utils/errorOutput.js");
          reportCommandError({ error });
          process.exit(1);
        }
      },
    );

  // `langwatch ingest install <tool>` — hidden primitive used by CI /
  // devcontainer / scripted setups. The user surface is
  // `langwatch <tool>` (the wrapper auto-resolves Path A vs Path B
  // per cfg.tool_mode + VK presence). Kept registered so existing
  // scripts continue to work and so reviewers can find the install
  // helper from the help with `--help --all` if needed.
  ingestCmd
    .command("install <tool>", { hidden: true })
    .description(
      "Hidden: low-level Path B install primitive. Normal users run `langwatch <tool>` which auto-installs when needed.",
    )
    .option(
      "--env-only",
      "skip the tool's own config writes; print exports only",
    )
    .option("--json", "emit machine-readable JSON")
    .action(
      async (
        tool: string,
        options: { envOnly?: boolean; json?: boolean },
      ) => {
        const { installCommand } = await import(
          "./commands/ingestion/install.js"
        );
        await installCommand(tool, options);
      },
    );

  // `langwatch ingest hook <tool>`: what the agent's own hook entries run.
  // Hidden: nobody types this, the install path writes it into the agent's
  // settings. It reads its payload on stdin, writes nothing to stdout (a
  // SessionStart hook's stdout is injected into the user's session context)
  // and always exits zero, so a hook can never be why a session broke.
  //
  // Registered as rendering its own result because it renders NO result, in
  // any format. Left unregistered, the auto-detected agent mode a hook always
  // runs under (Claude Code sets CLAUDECODE in its children) would print
  // "the table below is not machine-readable" to stderr on every session
  // start and stop, about a table that does not exist.
  rendersOwnResult(
    ingestCmd
      .command("hook <tool>", { hidden: true })
      .description(
        "Hidden: reports the session's repository, branch and worktree. Run by the coding agent's own hooks, reading the hook payload on stdin.",
      ),
  ).action(async (tool: string) => {
    try {
      const { hookCommand } = await import("./commands/ingestion/hook.js");
      await hookCommand({ tool });
    } catch {
      // Same contract as the command itself: never break the session.
    }
  });

  const governanceCmd = program
    .command("governance")
    .description(
      "Manage governance resources (ingestion templates). Every change is recorded in the organization's audit log.",
    );

  governanceCmd
    .command("status")
    .description("Show how far your organization's governance setup has progressed (sources, tools, telemetry).")
    .option("--json", "emit machine-readable JSON")
    .action(async (options: { json?: boolean }) => {
      try {
        const { governanceStatusCommand } = await import("./commands/governance/status.js");
        await governanceStatusCommand(options);
      } catch (error) {
        const { reportCommandError } = await import("./utils/errorOutput.js");
        reportCommandError({ error });
        process.exit(1);
      }
    });

  // ── Ingestion templates (admin/platform-curated catalog) ──────────────────

  const templatesCmd = governanceCmd
    .command("ingestion-templates")
    .description("CRUD on IngestionTemplate rows. Reads use aiTools:view; mutations use aiTools:manage.");

  templatesCmd
    .command("admin-list")
    .description("Admin readonly catalog — includes ottl_rules. Requires aiTools:manage.")
    .option("--json", "emit machine-readable JSON")
    .action(async (options: { json?: boolean }) => {
      const { adminListCommand } = await import(
        "./commands/governance/ingestion-templates.js"
      );
      await adminListCommand(options);
    });

  templatesCmd
    .command("get <id>")
    .description("Fetch a single ingestion template by id.")
    .option("--json", "emit machine-readable JSON")
    .action(async (id: string, options: { json?: boolean }) => {
      const { getCommand } = await import(
        "./commands/governance/ingestion-templates.js"
      );
      await getCommand(id, options);
    });

  templatesCmd
    .command("create")
    .description("Author a new org-authored ingestion template.")
    .requiredOption("--source-type <slug>", "lowercase letters/digits/underscores, max 40 chars")
    .requiredOption("--display-name <name>", "human-readable label")
    .option("--description <text>", "optional description")
    .option("--icon-asset <asset>", "preset:<kind> | data:image/svg+xml;base64,...")
    .option(
      "--credential-schema <kind>",
      "otlp_token | static_api_key | agent_id (defaults to otlp_token)",
    )
    .option("--ottl-rules <text>", "OTTL rules (newline-separated statements)")
    .option("--json", "emit machine-readable JSON")
    .action(
      async (options: {
        sourceType: string;
        displayName: string;
        description?: string;
        iconAsset?: string;
        credentialSchema?: string;
        ottlRules?: string;
        json?: boolean;
      }) => {
        const { createCommand } = await import(
          "./commands/governance/ingestion-templates.js"
        );
        await createCommand(options);
      },
    );

  templatesCmd
    .command("update-ottl-rules <id>")
    .description("Replace ottl_rules on an org-authored template. Platform rows reject.")
    .requiredOption("--ottl-rules <text>", "OTTL rules (newline-separated statements)")
    .option("--json", "emit machine-readable JSON")
    .action(
      async (id: string, options: { ottlRules: string; json?: boolean }) => {
        const { updateOttlRulesCommand } = await import(
          "./commands/governance/ingestion-templates.js"
        );
        await updateOttlRulesCommand(id, options);
      },
    );

  templatesCmd
    .command("archive <id>")
    .description("Soft-archive an org-authored template. Platform rows reject.")
    .option("--json", "emit machine-readable JSON")
    .action(async (id: string, options: { json?: boolean }) => {
      const { archiveCommand } = await import(
        "./commands/governance/ingestion-templates.js"
      );
      await archiveCommand(id, options);
    });

  templatesCmd
    .command("clone-from-platform <sourceTemplateId>")
    .description("Clone a platform-published template into the caller's org for OTTL customisation.")
    .option("--json", "emit machine-readable JSON")
    .action(
      async (sourceTemplateId: string, options: { json?: boolean }) => {
        const { cloneFromPlatformCommand } = await import(
          "./commands/governance/ingestion-templates.js"
        );
        await cloneFromPlatformCommand(sourceTemplateId, options);
      },
    );

  // Add prompt command group
  const promptCmd = program
    .command("prompt")
    .description("Manage prompt dependencies");

  promptCmd
    .command("init")
    .description("Initialize a new prompts project")
    .action(async () => {
      try {
        await initCommand();
      } catch (error) {
        const { reportCommandError } = await import("./utils/errorOutput.js");
        reportCommandError({ error });
        process.exit(1);
      }
    });

  emitsResult(
    promptCmd
      .command("create <name>")
      .description("Create a new prompt YAML file with default content")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (name: string) => {
      try {
        const { createCommand: impl } = await import("./commands/create.js");
        return await impl(name);
      } catch (error) {
        const { reportCommandError } = await import("./utils/errorOutput.js");
        reportCommandError({ error });
        process.exit(1);
      }
    },
  );

  promptCmd
    .command("add <spec> [localFile]")
    .description("Add a prompt dependency (e.g., 'agent/foo', 'agent/bar@5') or local file")
    .action(async (spec: string, localFile?: string) => {
      try {
        if (localFile) {
          await addCommand(spec, { localFile });
        } else {
          const { name, version } = parsePromptSpec(spec);
          await addCommand(name, { version });
        }
      } catch (error) {
        const { reportCommandError } = await import("./utils/errorOutput.js");
        reportCommandError({ error });
        process.exit(1);
      }
    });

  promptCmd
    .command("remove <name>")
    .description("Remove a prompt dependency")
    .action(async (name: string) => {
      try {
        await removeCommand(name);
      } catch (error) {
        const { reportCommandError } = await import("./utils/errorOutput.js");
        reportCommandError({ error });
        process.exit(1);
      }
    });

  emitsResult(
    promptCmd
      .command("list")
      .description("List all available prompts on the server")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async () => {
      try {
        const { listCommand: impl } = await import("./commands/list.js");
        return await impl();
      } catch (error) {
        const { reportCommandError } = await import("./utils/errorOutput.js");
        reportCommandError({ error });
        process.exit(1);
      }
    },
  );

  promptCmd
    .command("sync")
    .description("Sync prompts - fetch remote and push local")
    .action(async () => {
      try {
        await syncCommand();
      } catch (error) {
        const { reportCommandError } = await import("./utils/errorOutput.js");
        reportCommandError({ error });
        process.exit(1);
      }
    });

  promptCmd
    .command("pull")
    .description("Pull remote prompts and materialize locally")
    .option("--tag <name>", "Pull the version pointed to by this tag instead of the configured version")
    .action(async (options: { tag?: string }) => {
      try {
        await pullCommand(options);
      } catch (error) {
        const { reportCommandError } = await import("./utils/errorOutput.js");
        reportCommandError({ error });
        process.exit(1);
      }
    });

  promptCmd
    .command("push")
    .description("Push local prompts to the server")
    .option("--force-local", "Auto-resolve conflicts by keeping local version")
    .option("--force-remote", "Auto-resolve conflicts by keeping remote version")
    .action(async (options: { forceLocal?: boolean; forceRemote?: boolean }) => {
      try {
        await pushCommand({ forceLocal: options.forceLocal, forceRemote: options.forceRemote });
      } catch (error) {
        const { reportCommandError } = await import("./utils/errorOutput.js");
        reportCommandError({ error });
        process.exit(1);
      }
    });

  emitsResult(
    promptCmd
      .command("get <handle>")
      .description("Show one prompt, with its model and messages")
      .option("--version <version>", "Read a specific version instead of the latest")
      .option("--tag <name>", "Read the version this tag points at")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (handle: string, options: { version?: string; tag?: string }) => {
      const { promptGetCommand: impl } = await import("./commands/prompt/get.js");
      return impl(handle, options);
    },
  );

  emitsResult(
    promptCmd
      .command("versions <handle>")
      .description("List all versions of a prompt")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (handle: string) => {
      const { promptVersionsCommand: impl } = await import("./commands/prompt/versions.js");
      return impl(handle);
    },
  );

  emitsResult(
    promptCmd
      .command("restore <handle> <versionId>")
      .description("Restore a prompt to a previous version (creates a new version with that config)")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (handle: string, versionId: string) => {
      const { promptRestoreCommand: impl } = await import("./commands/prompt/restore.js");
      return impl(handle, versionId);
    },
  );

  // Add prompt tag subcommand group
  const tagCmd = promptCmd
    .command("tag")
    .description("Manage prompt tags");

  emitsResult(
    tagCmd
      .command("list")
      .description("List all tag definitions for the organization")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async () => {
      try {
        const { tagListCommand: impl } = await import("./commands/tag/list.js");
        return await impl();
      } catch (error) {
        const { reportCommandError } = await import("./utils/errorOutput.js");
        reportCommandError({ error });
        process.exit(1);
      }
    },
  );

  emitsResult(
    tagCmd
      .command("create <name>")
      .description("Create a custom tag"),
    async (name: string) => {
      try {
        const { tagCreateCommand: impl } = await import("./commands/tag/create.js");
        return await impl(name);
      } catch (error) {
        const { reportCommandError } = await import("./utils/errorOutput.js");
        reportCommandError({ error });
        process.exit(1);
      }
    },
  );

  emitsResult(
    tagCmd
      .command("rename <oldName> <newName>")
      .description("Rename a tag"),
    async (oldName: string, newName: string) => {
      try {
        const { tagRenameCommand: impl } = await import("./commands/tag/rename.js");
        return await impl(oldName, newName);
      } catch (error) {
        const { reportCommandError } = await import("./utils/errorOutput.js");
        reportCommandError({ error });
        process.exit(1);
      }
    },
  );

  emitsResult(
    tagCmd
      .command("assign <prompt> <tag>")
      .description("Assign a tag to a prompt version")
      .option("--version <number>", "Version number to assign (defaults to latest)"),
    async (prompt: string, tag: string, options: { version?: string }) => {
      try {
        const { tagAssignCommand: impl } = await import("./commands/tag/assign.js");
        return await impl(prompt, tag, options);
      } catch (error) {
        const { reportCommandError } = await import("./utils/errorOutput.js");
        reportCommandError({ error });
        process.exit(1);
      }
    },
  );

  emitsResult(
    tagCmd
      .command("delete <name>")
      .description("Delete a tag and remove all its assignments")
      .option("--force", "Skip confirmation prompt"),
    async (name: string, options: { force?: boolean }) => {
      try {
        const { tagDeleteCommand: impl } = await import("./commands/tag/delete.js");
        return await impl(name, options);
      } catch (error) {
        const { reportCommandError } = await import("./utils/errorOutput.js");
        reportCommandError({ error });
        process.exit(1);
      }
    },
  );

  // Status command - project overview
  rendersOwnResult(
    program
      .command("status")
      .description("Show project resource counts and available commands")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
  ).action(async (_options: unknown, command: Command) => {
    const { statusCommand: impl } = await import("./commands/status.js");
    await impl(command.optsWithGlobals());
  });

  // Discoverability — the machine-readable catalog + compact help tree agents
  // use to learn the CLI without human docs (gcx `commands` / `help-tree`).
  emitsResult(
    program
      .command("commands")
      .description(
        "Machine-readable catalog of every CLI command: path, args, flags, hints, skill annotations, token costs",
      )
      .option("--flat", "Flatten the command tree to a single list"),
    async (options: { flat?: boolean }) => {
      const { commandsCommand: impl } = await import("./commands/commands.js");
      return impl(options);
    },
  );

  emitsResult(
    program
      .command("help-tree")
      .description(
        "Compact indented tree of all commands with # hint:/# skill: annotations (for agent context injection)",
      ),
    async (_options: RawOutputFlags, command: Command) => {
      const { helpTreeCommand: impl } = await import("./commands/help-tree.js");
      // Merged globals, not the leaf's own opts: `lw --output json help-tree`
      // is the root-position spelling the help text teaches, and commander puts
      // those only on the ROOT — so reading the leaf would miss the very flag
      // that decides tree-vs-catalog here.
      return impl(command.optsWithGlobals());
    },
  );

  // Help TOPICS (`gh help formatting` style). Registered as a real command:
  // a command named `help` suppresses commander's implicit one (whose dispatch
  // is internal and could never reach a topic page), so `langwatch help
  // agent-mode` lands in this action. A REAL command always wins the lookup —
  // `help agent` reaches the `agent` group — and topics are never named after
  // a command (asserted in commands/__tests__); see commands/help.ts.
  program
    .command("help [topic...]")
    .description(
      "Show help for a command or a help topic (`langwatch help agent-mode` is the agent-mode guide)",
    )
    .action(async (topic: string[] = []) => {
      const { helpCommand: impl } = await import("./commands/help.js");
      impl(program, topic);
    });

  // `langwatch skills *` — the bundled agent skills (compiled from skills/ at
  // the repo root into the CLI at build time): list/get/install them into
  // ~/.agents/skills, gcx `agent skills` semantics. Named `skills`, not
  // `agent skills` — the top-level `agent` group is agent definitions.
  const skillsCmd = program
    .command("skills")
    .description(
      "List, inspect, and install LangWatch's bundled agent skills (default install root: ~/.agents/skills)",
    );

  rendersOwnResult(
    skillsCmd
      .command("list")
      .description("List every bundled skill with its installed state")
      .option("--dir <root>", "Install root to check (default ~/.agents)"),
  ).action(async (_options: unknown, command: Command) => {
    try {
      const { skillsListCommand: impl } = await import("./commands/skills/list.js");
      await impl(command.optsWithGlobals());
    } catch (error) {
      const { reportCommandError } = await import("./utils/errorOutput.js");
      reportCommandError({ error });
      process.exit(1);
    }
  });

  rendersOwnResult(
    skillsCmd
      .command("get <name>")
      .description("Print a skill's full body on stdout (raw markdown, for piping into agent context)"),
  ).action(async (name: string, _options: unknown, command: Command) => {
    try {
      const { skillsGetCommand: impl } = await import("./commands/skills/get.js");
      await impl(name, command.optsWithGlobals());
    } catch (error) {
      const { reportCommandError } = await import("./utils/errorOutput.js");
      reportCommandError({ error });
      process.exit(1);
    }
  });

  rendersOwnResult(
    skillsCmd
      .command("install [names...]")
      .description("Install skills into <dir>/skills/<slug>/SKILL.md (recipes nest under recipes/<slug>/)")
      .option("--all", "Install every skill in the bundle")
      .option("--dir <root>", "Install root (default ~/.agents)")
      .option("--dry-run", "Report what would happen without writing anything")
      .option("--force", "Overwrite files that differ from the bundle")
      .option("-y, --yes", "Confirm overwriting files the bundle does not manage (required in non-TTY/agent contexts)"),
  )
    .action(async (names: string[], _options: unknown, command: Command) => {
      try {
        const { skillsInstallCommand: impl } = await import("./commands/skills/install.js");
        await impl(names, command.optsWithGlobals());
      } catch (error) {
        const { reportCommandError } = await import("./utils/errorOutput.js");
        reportCommandError({ error });
        process.exit(1);
      }
    });

  rendersOwnResult(
    skillsCmd
      .command("uninstall [names...]")
      .description("Remove installed skills (only files the bundle manages; never prompts non-interactively)")
      .option("--all", "Uninstall every skill in the bundle")
      .option("--dir <root>", "Install root (default ~/.agents)")
      .option("--dry-run", "Report what would happen without removing anything")
      .option("-y, --yes", "Skip the confirmation prompt (required in non-TTY/agent contexts)"),
  )
    .action(async (names: string[], _options: unknown, command: Command) => {
      try {
        const { skillsUninstallCommand: impl } = await import("./commands/skills/uninstall.js");
        await impl(names, command.optsWithGlobals());
      } catch (error) {
        const { reportCommandError } = await import("./utils/errorOutput.js");
        reportCommandError({ error });
        process.exit(1);
      }
    });

  rendersOwnResult(
    skillsCmd
      .command("update [names...]")
      .description("Refresh installed skills whose content differs from the bundle (no names: all installed)")
      .option("--dir <root>", "Install root (default ~/.agents)")
      .option("--dry-run", "Report what would happen without writing anything")
      .option("--force", "Overwrite managed files that carry local edits")
      .option("-y, --yes", "Confirm overwriting files the bundle does not manage (required in non-TTY/agent contexts)"),
  )
    .action(async (names: string[], _options: unknown, command: Command) => {
      try {
        const { skillsUpdateCommand: impl } = await import("./commands/skills/update.js");
        await impl(names, command.optsWithGlobals());
      } catch (error) {
        const { reportCommandError } = await import("./utils/errorOutput.js");
        reportCommandError({ error });
        process.exit(1);
      }
    });

  // Docs commands - fetch markdown documentation for LangWatch and Scenario
  program
    .command("docs [url]")
    .description(
      "Fetch LangWatch documentation as markdown. Pass no argument for the index (llms.txt), a path like 'integration/python/guide', or a full URL. Missing extensions default to .md.",
    )
    .action(async (url?: string) => {
      try {
        const { docsCommand: impl } = await import("./commands/docs.js");
        await impl(url);
      } catch (error) {
        const { reportCommandError } = await import("./utils/errorOutput.js");
        reportCommandError({ error });
        process.exit(1);
      }
    });

  program
    .command("scenario-docs [url]")
    .description(
      "Fetch LangWatch Scenario documentation as markdown. Pass no argument for the index, a path like 'advanced/red-teaming', or a full URL. Missing extensions default to .md.",
    )
    .action(async (url?: string) => {
      try {
        const { scenarioDocsCommand: impl } = await import("./commands/docs.js");
        await impl(url);
      } catch (error) {
        const { reportCommandError } = await import("./utils/errorOutput.js");
        reportCommandError({ error });
        process.exit(1);
      }
    });

  // Add evaluator command group
  const evaluatorCmd = program
    .command("evaluator")
    .description("Manage evaluator definitions");

  emitsResult(
    evaluatorCmd
      .command("list")
      .description("List all evaluators in the project")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async () => {
      try {
        const { listEvaluatorsCommand: impl } = await import("./commands/evaluators/list.js");
        return await impl();
      } catch (error) {
        const { reportCommandError } = await import("./utils/errorOutput.js");
        reportCommandError({ error });
        process.exit(1);
      }
    },
  );

  emitsResult(
    evaluatorCmd
      .command("get <idOrSlug>")
      .description("Get evaluator details by ID or slug")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (idOrSlug: string) => {
      try {
        const { getEvaluatorCommand: impl } = await import("./commands/evaluators/get.js");
        return await impl(idOrSlug);
      } catch (error) {
        const { reportCommandError } = await import("./utils/errorOutput.js");
        reportCommandError({ error });
        process.exit(1);
      }
    },
  );

  emitsResult(
    evaluatorCmd
      .command("types")
      .description("List every evaluator type that `evaluator create --type` accepts")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async () => {
      try {
        const { listEvaluatorTypesCommand: impl } = await import("./commands/evaluators/types.js");
        return impl();
      } catch (error) {
        const { reportCommandError } = await import("./utils/errorOutput.js");
        reportCommandError({ error });
        process.exit(1);
      }
    },
  );

  emitsResult(
    evaluatorCmd
      .command("create <name>")
      .description("Create a new evaluator")
      .requiredOption(
        "--type <evaluatorType>",
        "Evaluator type (e.g. langevals/llm_boolean; see `langwatch evaluator types`)",
      )
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (name: string, options: { type: string }) => {
      try {
        const { createEvaluatorCommand: impl } = await import("./commands/evaluators/create.js");
        return await impl(name, options);
      } catch (error) {
        const { reportCommandError } = await import("./utils/errorOutput.js");
        reportCommandError({ error });
        process.exit(1);
      }
    },
  );

  emitsResult(
    evaluatorCmd
      .command("update <idOrSlug>")
      .description("Update an evaluator name or settings")
      .option("--name <name>", "New evaluator name")
      .option("--settings <json>", "Evaluator config settings as JSON")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (idOrSlug: string, options: { name?: string; settings?: string }) => {
      try {
        const { updateEvaluatorCommand: impl } = await import("./commands/evaluators/update.js");
        return await impl(idOrSlug, options);
      } catch (error) {
        const { reportCommandError } = await import("./utils/errorOutput.js");
        reportCommandError({ error });
        process.exit(1);
      }
    },
  );

  emitsResult(
    evaluatorCmd
      .command("delete <idOrSlug>")
      .description("Archive (soft-delete) an evaluator")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (idOrSlug: string) => {
      try {
        const { deleteEvaluatorCommand: impl } = await import("./commands/evaluators/delete.js");
        return await impl(idOrSlug);
      } catch (error) {
        const { reportCommandError } = await import("./utils/errorOutput.js");
        reportCommandError({ error });
        process.exit(1);
      }
    },
  );

  // Add experiment command group — run, monitor, list, and inspect experiments
  const experimentCmd = program
    .command("experiment")
    .description("Run, monitor, list, and inspect experiments");

  emitsResult(
    experimentCmd
      .command("list")
      .description("List experiments in the project")
      .option("-f, --format <format>", "Output format: table (default) or json", "table")
      .option("--limit <n>", "Maximum experiments to fetch (default 50, max 200)", "50"),
    async (options: { limit?: string }) => {
      const { experimentListCommand: impl } = await import("./commands/experiment/list.js");
      return impl(options);
    },
  );

  emitsResult(
    experimentCmd
      .command("run <slug>")
      .description("Start an experiment run by slug")
      .option("--wait", "Wait for the experiment to complete before returning")
      .option("--param <pair>", PARAM_FLAG_HELP, collectParam)
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (slug: string, options: { wait?: boolean; param?: string[] }) => {
      const { runExperimentCommand: impl } = await import("./commands/experiment/run.js");
      return impl(slug, options);
    },
  );

  emitsResult(
    experimentCmd
      .command("status <experiment>")
      .description("Check the status of an experiment run (defaults to the latest run)")
      .option("-f, --format <format>", "Output format: table (default) or json", "table")
      .option("--run-id <id>", "Specific run id to check (defaults to the latest run)")
      .option(
        "--wait",
        "Keep reading until the run finishes, or until the limit is up. Answers with the progress either way",
      )
      .option(
        "--timeout <seconds>",
        "How long --wait waits before answering with the progress so far (default: 60)",
      ),
    async (
      experiment: string,
      options: { runId?: string; wait?: boolean; timeout?: string },
    ) => {
      const { experimentStatusCommand: impl } = await import("./commands/experiment/status.js");
      return impl(experiment, options);
    },
  );

  emitsResult(
    experimentCmd
      .command("list-runs <experiment>")
      .description("List experiment runs for an experiment by slug")
      .option("-f, --format <format>", "Output format: table (default) or json", "table")
      .option("--limit <n>", "Maximum runs to fetch (default 50, max 200)", "50"),
    async (
      experiment: string,
      options: {
        limit?: string;
      },
    ) => {
      const { experimentListRunsCommand: impl } = await import("./commands/experiment/list-runs.js");
      return impl({ experiment, ...options });
    },
  );

  emitsResult(
    experimentCmd
      .command("results <experiment>")
      .description(
        "Fetch per-row results for an experiment run, defaulting to the latest run (debug evaluator scores and missed rows)",
      )
      .option("--run-id <id>", "Specific run id to fetch (defaults to the latest run)")
      .option("--filter <filter>", "Filter rows: failed | all (default)", "all")
      .option("--evaluator <name>", "Show only this evaluator's column")
      .option("-f, --format <format>", "Output format: table (default) or json", "table")
      .option("--limit <n>", "Maximum rows to print in table mode (default 20)", "20"),
    async (
      experiment: string,
      options: {
        runId?: string;
        filter?: string;
        evaluator?: string;
        limit?: string;
      },
    ) => {
      const { experimentResultsCommand: impl } = await import("./commands/experiment/results.js");
      return impl({ experimentSlug: experiment, options });
    },
  );

  emitsResult(
    experimentCmd
      .command("create")
      .description("Create an experiment")
      .option("--name <name>", "Name for the experiment")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (options: { name?: string }) => {
      const { experimentCreateCommand: impl } = await import("./commands/experiment/create.js");
      return impl(options);
    },
  );

  emitsResult(
    experimentCmd
      .command("get-state <experiment>")
      .description("Read an experiment's setup, with the version to save it back at")
      .option("--fields <fields>", "Set to `version` to read the version only, without the setup")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (experiment: string, options: { fields?: string }) => {
      const { experimentGetStateCommand: impl } = await import("./commands/experiment/get-state.js");
      return impl(experiment, options);
    },
  );

  emitsResult(
    experimentCmd
      .command("set-state <experiment>")
      .description("Save an experiment's setup from a file, or from stdin with --file -")
      .option("--file <path>", "File holding the setup as JSON, or - to read stdin")
      .option("--expected-version <n>", "Refuse the save if someone else already wrote on top of this version")
      .option("--message <text>", "Name this version in the history")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (
      experiment: string,
      options: { file?: string; expectedVersion?: string; message?: string },
    ) => {
      const { experimentSetStateCommand: impl } = await import("./commands/experiment/set-state.js");
      return impl(experiment, options);
    },
  );

  emitsResult(
    experimentCmd
      .command("versions <experiment>")
      .description("List the saved versions of an experiment's setup")
      .option("--limit <n>", "Maximum versions to fetch (default 50, max 100)", "50")
      .option("--cursor <version>", "The nextCursor of the previous page")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (experiment: string, options: { limit?: string; cursor?: string }) => {
      const { experimentVersionsCommand: impl } = await import("./commands/experiment/versions.js");
      return impl(experiment, options);
    },
  );

  emitsResult(
    experimentCmd
      .command("restore <experiment> <version>")
      .description("Restore an experiment to one of its saved versions")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (experiment: string, version: string) => {
      const { experimentRestoreCommand: impl } = await import("./commands/experiment/restore.js");
      return impl(experiment, version);
    },
  );

  // Add workflow command group
  const workflowCmd = program
    .command("workflow")
    .description("Manage workflows");

  emitsResult(
    workflowCmd
      .command("list")
      .description("List all workflows in the project")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async () => {
      const { listWorkflowsCommand: impl } = await import("./commands/workflows/list.js");
      return impl();
    },
  );

  emitsResult(
    workflowCmd
      .command("get <id>")
      .description("Get workflow details by ID")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (id: string) => {
      const { getWorkflowCommand: impl } = await import("./commands/workflows/get.js");
      return impl(id);
    },
  );

  emitsResult(
    workflowCmd
      .command("update <id>")
      .description("Update a workflow's metadata (name, icon, description)")
      .option("--name <name>", "New workflow name")
      .option("--icon <icon>", "New workflow icon")
      .option("--description <desc>", "New workflow description")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (id: string, options: { name?: string; icon?: string; description?: string }) => {
      const { updateWorkflowCommand: impl } = await import("./commands/workflows/update.js");
      return impl(id, options);
    },
  );

  emitsResult(
    workflowCmd
      .command("run <id>")
      .description("Execute a workflow with JSON input")
      .option("--input <json>", "Input data as JSON string")
      .option("--param <pair>", WORKFLOW_PARAM_FLAG_HELP, collectParam)
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (id: string, options: { input?: string; param?: string[] }) => {
      const { runWorkflowCommand: impl } = await import("./commands/workflows/run.js");
      return impl({ id, options });
    },
  );

  emitsResult(
    workflowCmd
      .command("delete <id>")
      .description("Archive (soft-delete) a workflow")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (id: string) => {
      const { deleteWorkflowCommand: impl } = await import("./commands/workflows/delete.js");
      return impl(id);
    },
  );

  // Add agent command group
  const agentCmd = program
    .command("agent")
    .description("Manage agent definitions");

  emitsResult(
    agentCmd
      .command("list")
      .description("List all agents in the project")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async () => {
      const { listAgentsCommand: impl } = await import("./commands/agents/list.js");
      return impl();
    },
  );

  emitsResult(
    agentCmd
      .command("get <id>")
      .description("Get agent details by ID")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (id: string) => {
      const { getAgentCommand: impl } = await import("./commands/agents/get.js");
      return impl(id);
    },
  );

  emitsResult(
    agentCmd
      .command("create <name>")
      .description("Create a new agent")
      .requiredOption("--type <type>", "Agent type: signature, code, workflow, or http")
      .option("--config <json>", "Agent config as JSON")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (name: string, options: { type: string; config?: string }) => {
      const { createAgentCommand: impl } = await import("./commands/agents/create.js");
      return impl(name, options);
    },
  );

  emitsResult(
    agentCmd
      .command("run <id>")
      .description("Execute an agent with JSON input (HTTP agents call URL directly, others use workflow engine)")
      .option("--input <json>", "Input data as JSON string")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (id: string, options: { input?: string }) => {
      const { runAgentCommand: impl } = await import("./commands/agents/run.js");
      return impl(id, options);
    },
  );

  // A live, human-only session: it never returns a CommandResult, so it is
  // registered with a plain action and the format gate honestly refuses
  // `-o json` instead of accepting a format the command never renders.
  agentCmd
    .command("dev")
    .alias("tunnel")
    .description("Expose a local agent server through a public tunnel and point a registered HTTP agent at it (Ctrl-C restores the previous URL)")
    .option("--port <number>", "Local port to expose (tunnels http://localhost:<number>)")
    .option("--url <url>", "Local URL to expose (mutually exclusive with --port)")
    .option("--agent <idOrName>", "Which registered HTTP agent to point at the tunnel (when omitted: picker, and in an interactive terminal it creates one if the project has none)")
    .option("--tunnel-url <url>", "Bring your own tunnel URL and skip tunnel provisioning")
    .option("--no-update-url", "Print the tunnel URL without changing the agent")
    .option("--no-auth", "Skip the local auth proxy (for servers that already authenticate requests)")
    .option("--api-key <key>", "API key to use for this run")
    .action(
      async (options: {
        port?: string;
        url?: string;
        agent?: string;
        tunnelUrl?: string;
        updateUrl?: boolean;
        auth?: boolean;
        apiKey?: string;
      }) => {
        const { agentDevCommand: impl } = await import("./commands/agents/dev.js");
        return impl(options);
      },
    );

  emitsResult(
    agentCmd
      .command("update <id>")
      .description("Update an agent name, type, or configuration")
      .option("--name <name>", "New agent name")
      .option("--type <type>", "New agent type: signature, code, workflow, or http")
      .option("--config <json>", "Updated configuration as JSON")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (id: string, options: { name?: string; type?: string; config?: string }) => {
      const { updateAgentCommand: impl } = await import("./commands/agents/update.js");
      return impl(id, options);
    },
  );

  emitsResult(
    agentCmd
      .command("delete <id>")
      .description("Archive (soft-delete) an agent")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (id: string) => {
      const { deleteAgentCommand: impl } = await import("./commands/agents/delete.js");
      return impl(id);
    },
  );

  // Add dashboard command group
  const dashboardCmd = program
    .command("dashboard")
    .description("Manage analytics dashboards");

  emitsResult(
    dashboardCmd
      .command("list")
      .description("List all dashboards in the project")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async () => {
      const { listDashboardsCommand: impl } = await import("./commands/dashboards/list.js");
      return impl();
    },
  );

  emitsResult(
    dashboardCmd
      .command("get <id>")
      .description("Get dashboard details by ID")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (id: string) => {
      const { getDashboardCommand: impl } = await import("./commands/dashboards/get.js");
      return impl(id);
    },
  );

  emitsResult(
    dashboardCmd
      .command("update <id>")
      .description("Rename a dashboard")
      .requiredOption("--name <name>", "New dashboard name")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (id: string, options: { name?: string }) => {
      const { updateDashboardCommand: impl } = await import("./commands/dashboards/update.js");
      return impl(id, options);
    },
  );

  emitsResult(
    dashboardCmd
      .command("create <name>")
      .description("Create a new dashboard")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (name: string) => {
      const { createDashboardCommand: impl } = await import("./commands/dashboards/create.js");
      return impl(name);
    },
  );

  emitsResult(
    dashboardCmd
      .command("delete <id>")
      .description("Delete a dashboard and its graphs")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (id: string) => {
      const { deleteDashboardCommand: impl } = await import("./commands/dashboards/delete.js");
      return impl(id);
    },
  );

  // Add model-provider command group
  const modelProviderCmd = program
    .command("model-provider")
    .description("Manage LLM model provider configurations");

  emitsResult(
    modelProviderCmd
      .command("list")
      .description("List all configured model providers")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async () => {
      const { listModelProvidersCommand: impl } = await import("./commands/model-providers/list.js");
      return impl();
    },
  );

  emitsResult(
    modelProviderCmd
      .command("set <provider>")
      .description("Configure a model provider (e.g. openai, anthropic)")
      .option("--enabled <boolean>", "Enable or disable the provider", (v) => v === "true")
      .option("--api-key <key>", "API key for the provider")
      .option("--default-model <model>", "Default model to use (e.g. gpt-5-mini)")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (provider: string, options: { enabled?: boolean; apiKey?: string; defaultModel?: string }) => {
      const { setModelProviderCommand: impl } = await import("./commands/model-providers/set.js");
      return impl(provider, options);
    },
  );

  // Add model-default command group (cascading default models)
  const modelDefaultCmd = program
    .command("model-default")
    .description(
      "Manage cascading default models (per role/feature, per scope: project/team/organization)",
    );

  emitsResult(
    modelDefaultCmd
      .command("list")
      .description("Show the effective resolution + every config you can read")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async () => {
      const { listModelDefaultsCommand: impl } = await import(
        "./commands/model-defaults/list.js"
      );
      return impl();
    },
  );

  emitsResult(
    modelDefaultCmd
      .command("set <key> <model>")
      .description(
        "Set a default model for a role (DEFAULT|FAST|EMBEDDINGS) or registered feature key. Defaults to project scope; pass --scope team|organization for higher tiers.",
      )
      .option("--scope <scope>", "Scope tier: project (default), team, or organization", "project")
      .option(
        "--scope-id <id>",
        "Explicit scope id. Defaults to the API key's project / its team / its organization.",
      )
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (
      key: string,
      model: string,
      options: { scope?: "project" | "team" | "organization"; scopeId?: string },
    ) => {
      const { setModelDefaultCommand: impl } = await import(
        "./commands/model-defaults/set.js"
      );
      return impl(key, model, options);
    },
  );

  emitsResult(
    modelDefaultCmd
      .command("unset <key>")
      .description("Remove a default model for a role or feature key at the chosen scope")
      .option("--scope <scope>", "Scope tier: project (default), team, or organization", "project")
      .option(
        "--scope-id <id>",
        "Explicit scope id. Defaults to the API key's project / its team / its organization.",
      )
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (
      key: string,
      options: { scope?: "project" | "team" | "organization"; scopeId?: string },
    ) => {
      const { unsetModelDefaultCommand: impl } = await import(
        "./commands/model-defaults/unset.js"
      );
      return impl(key, options);
    },
  );

  // Add virtual-keys command group (AI Gateway)
  const virtualKeysCmd = program
    .command("virtual-keys")
    .alias("vk")
    .description("Manage AI Gateway virtual keys (list, create, rotate, revoke)");

  emitsResult(
    virtualKeysCmd
      .command("list")
      .description("List all virtual keys for the current project")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async () => {
      const { listVirtualKeysCommand: impl } = await import("./commands/virtual-keys/list.js");
      return impl();
    },
  );

  emitsResult(
    virtualKeysCmd
      .command("get <id>")
      .description("Show details for a single virtual key")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (id: string) => {
      const { getVirtualKeyCommand: impl } = await import("./commands/virtual-keys/get.js");
      return impl(id);
    },
  );

  emitsResult(
    virtualKeysCmd
      .command("create")
      .description("Create a new virtual key (secret is shown once)")
      .requiredOption("--name <name>", "Human-readable name for the key")
      .option("--description <desc>", "Optional description")
      .option(
        "--scope <typeAndId>",
        "Scope row in type:id form (repeat the flag for several). Types: org | team | project. Defaults to the calling project when omitted. Example: --scope org:acme --scope team:platform",
        (value: string, previous: string[] = []) => [...previous, value],
      )
      .option("--trace-project <id>", "Explicit trace destination project for org- or team-scoped keys (needs virtualKeys:manage there)")
      .option("--routing-policy <id>", "RoutingPolicy id to pin (pairs with --routing-mode policy)")
      .option("--routing-mode <mode>", "none (default: no silent failover) | fallback_all | policy")
      .option("--principal-user <userId>", "Mark this VK as personal and attribute spend to the named principal user")
      .option("--budget-limit <usd>", "Cap the key's own spend (creates a VK-scoped budget atomically with the key)")
      .option("--budget-window <w>", "Budget window for --budget-limit: day | week | month")
      .option("--budget-breach <action>", "block (default) or warn when the key's budget is hit")
      .option("--providers-allowed <ids>", "Comma-separated ModelProvider ids the key may dispatch to (default: every provider in scope)")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (options: {
      name: string;
      description?: string;
      scope?: string[];
      traceProject?: string;
      routingPolicy?: string;
      routingMode?: string;
      principalUser?: string;
      budgetLimit?: string;
      budgetWindow?: string;
      budgetBreach?: "block" | "warn";
      providersAllowed?: string;
    }) => {
      const { createVirtualKeyCommand: impl } = await import("./commands/virtual-keys/create.js");
      return impl(options);
    },
  );

  emitsResult(
    virtualKeysCmd
      .command("spend <id>")
      .description("Read a key's aggregate spend (default window: current UTC month)")
      .option("--from <iso>", "Window start (ISO-8601, e.g. 2026-07-01T00:00:00Z)")
      .option("--to <iso>", "Window end (ISO-8601, exclusive)")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (id: string, options: { from?: string; to?: string }) => {
      const { virtualKeySpendCommand: impl } = await import("./commands/virtual-keys/spend.js");
      return impl(id, options);
    },
  );

  emitsResult(
    virtualKeysCmd
      .command("update <id>")
      .description("Update a virtual key's name/description/scopes/routing/budget/config")
      .option("--name <name>", "New display name")
      .option("--description <desc>", "New description")
      .option("--clear-description", "Clear the description")
      .option(
        "--scope <typeAndId>",
        "Replace the scope set (repeat the flag for several; supplies the full set). Same TYPE:id form as create.",
        (value: string, previous: string[] = []) => [...previous, value],
      )
      .option("--trace-project <id>", "Re-point the key's trace destination project (needs virtualKeys:manage there)")
      .option("--clear-trace-project", "Clear the explicit trace destination (falls back to project scope or governance project)")
      .option("--routing-policy <id>", "Switch to a different RoutingPolicy (pass id)")
      .option("--clear-routing-policy", "Unpin the routing policy; VK falls back to the org default ordering")
      .option("--routing-mode <mode>", "none | fallback_all | policy")
      .option("--budget-limit <usd>", "Upsert the key's own cap (pairs with --budget-window)")
      .option("--budget-window <w>", "Budget window for --budget-limit: day | week | month")
      .option("--budget-breach <action>", "block or warn when the key's budget is hit")
      .option("--clear-budget", "Archive the key's own budget (spend history is retained)")
      .option("--config-json <json>", "Inline partial config JSON (model_aliases/cache/fallback/rate_limits/policy_rules). Merges with existing config")
      .option("--config-file <path>", "Read partial config JSON from a file")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (id: string, options: {
      name?: string;
      description?: string;
      clearDescription?: boolean;
      scope?: string[];
      traceProject?: string;
      clearTraceProject?: boolean;
      routingPolicy?: string;
      clearRoutingPolicy?: boolean;
      routingMode?: string;
      budgetLimit?: string;
      budgetWindow?: string;
      budgetBreach?: "block" | "warn";
      clearBudget?: boolean;
      configJson?: string;
      configFile?: string;
    }) => {
      const { updateVirtualKeyCommand: impl } = await import("./commands/virtual-keys/update.js");
      return impl(id, options);
    },
  );

  emitsResult(
    virtualKeysCmd
      .command("rotate <id>")
      .description("Rotate a virtual key's secret (the old one keeps working for 24 hours)")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (id: string) => {
      const { rotateVirtualKeyCommand: impl } = await import("./commands/virtual-keys/rotate.js");
      return impl(id);
    },
  );

  emitsResult(
    virtualKeysCmd
      .command("disable <id>")
      .description("Disable a virtual key (reversible; requests get a distinct virtual_key_disabled error)")
      .option("--reason <text>", "Audit-logged note shown on the key's detail view")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (id: string, options: { reason?: string }) => {
      const { disableVirtualKeyCommand: impl } = await import("./commands/virtual-keys/disable.js");
      return impl(id, options);
    },
  );

  emitsResult(
    virtualKeysCmd
      .command("enable <id>")
      .description("Re-enable a disabled virtual key, restoring it exactly as it was")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (id: string) => {
      const { enableVirtualKeyCommand: impl } = await import("./commands/virtual-keys/disable.js");
      return impl(id);
    },
  );

  emitsResult(
    virtualKeysCmd
      .command("revoke <id>")
      .description("Revoke a virtual key (cannot be reactivated)")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (id: string) => {
      const { revokeVirtualKeyCommand: impl } = await import("./commands/virtual-keys/revoke.js");
      return impl(id);
    },
  );

  // Add gateway-budgets command group (AI Gateway)
  const gatewayBudgetsCmd = program
    .command("gateway-budgets")
    .description("Manage AI Gateway spend budgets (hierarchical scopes)");

  emitsResult(
    gatewayBudgetsCmd
      .command("list")
      .description("List all budgets across scopes")
      .option("--scope-type <kinds>", "Comma-separated filter: organization,team,project,virtual-key,principal,group (default: all)")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (options: { scopeType?: string }) => {
      const { listGatewayBudgetsCommand: impl } = await import("./commands/gateway-budgets/list.js");
      return impl(options);
    },
  );

  emitsResult(
    gatewayBudgetsCmd
      .command("create")
      .description("Create a new budget (scope + window + limit)")
      .requiredOption("--name <name>", "Human-readable budget name")
      .option("--description <desc>", "Optional description")
      .requiredOption("--scope <kind>", "Budget scope: organization|team|project|virtual-key|principal|group")
      .option("--organization <id>", "Organization id (for scope=organization)")
      .option("--team <id>", "Team id (for scope=team)")
      .option("--project <id>", "Project id (for scope=project)")
      .option("--virtual-key <id>", "Virtual key id (for scope=virtual-key)")
      .option("--principal <id>", "Principal user id (for scope=principal)")
      .option("--group <id>", "Group id (for scope=group; --limit becomes the PER-MEMBER allowance)")
      .requiredOption("--window <w>", "Budget window: minute|hour|day|week|month|total|manual")
      .requiredOption("--limit <usd>", "Hard cap in USD (e.g. 100 or 49.99). Per member for scope=group")
      .option("--on-breach <action>", "block (default) or warn", "block")
      .option("--timezone <tz>", "IANA timezone recorded on the budget for your own reporting. Window boundaries are UTC (e.g. Europe/Amsterdam)")
      .option("--provider-key <id>", "Pin the budget to one ModelProvider id (default: counts every provider)")
      .option("--cycle-anchor-at <rfc3339>", "Start the budget's cycle at this instant instead of the calendar (e.g. 2026-01-17T09:00:00Z). Not valid on total or manual windows")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (options: {
      name: string;
      description?: string;
      scope: "organization" | "team" | "project" | "virtual-key" | "principal" | "group";
      organization?: string;
      team?: string;
      project?: string;
      virtualKey?: string;
      principal?: string;
      group?: string;
      window: string;
      limit: string;
      onBreach?: "block" | "warn";
      timezone?: string;
      providerKey?: string;
      cycleAnchorAt?: string;
    }) => {
      const { createGatewayBudgetCommand: impl } = await import("./commands/gateway-budgets/create.js");
      return impl(options);
    },
  );

  emitsResult(
    gatewayBudgetsCmd
      .command("reset <id>")
      .description("Move a budget's period boundary to now (never mutates recorded spend)")
      .option("--end-user <id>", "Reset only this end user's bucket (attributed-user templates)")
      .option("--reason <text>", "Audit-logged note for the reset")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (id: string, options: { endUser?: string; reason?: string }) => {
      const { resetGatewayBudgetCommand: impl } = await import("./commands/gateway-budgets/reset.js");
      return impl(id, options);
    },
  );

  emitsResult(
    gatewayBudgetsCmd
      .command("update <id>")
      .description("Update a budget's name/description/limit/on-breach/timezone")
      .option("--name <name>", "New display name")
      .option("--description <desc>", "New description")
      .option("--clear-description", "Clear the description")
      .option("--limit <usd>", "New hard-cap in USD")
      .option("--on-breach <action>", "block or warn")
      .option("--timezone <tz>", "New IANA timezone. Recorded on the budget; window boundaries stay UTC")
      .option("--clear-timezone", "Clear the timezone override")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (id: string, options: {
      name?: string;
      description?: string;
      clearDescription?: boolean;
      limit?: string;
      onBreach?: "block" | "warn";
      timezone?: string;
      clearTimezone?: boolean;
    }) => {
      const { updateGatewayBudgetCommand: impl } = await import("./commands/gateway-budgets/update.js");
      return impl(id, options);
    },
  );

  emitsResult(
    gatewayBudgetsCmd
      .command("archive <id>")
      .description("Archive a budget (stops enforcement; does not delete history)")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (id: string) => {
      const { archiveGatewayBudgetCommand: impl } = await import("./commands/gateway-budgets/archive.js");
      return impl(id);
    },
  );

  // Add webhooks command group (org-anchored webhook platform)
  const webhooksCmd = program
    .command("webhooks")
    .description("Manage outbound webhook endpoints (org API key; enterprise)");

  emitsResult(
    webhooksCmd
      .command("list")
      .description("List the organization's webhook endpoints")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async () => {
      const { listWebhooksCommand: impl } = await import("./commands/webhooks/list.js");
      return impl();
    },
  );

  emitsResult(
    webhooksCmd
      .command("get <id>")
      .description("Get one webhook endpoint")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (id: string) => {
      const { getWebhookCommand: impl } = await import("./commands/webhooks/get.js");
      return impl(id);
    },
  );

  emitsResult(
    webhooksCmd
      .command("create")
      .description("Create an endpoint; prints the signing secret ONCE")
      .option("--url <url>", "HTTPS receiver URL")
      .option("--queue-url <url>", "Amazon SQS queue URL to deliver to instead of a receiver URL (standard queues only)")
      .option("--role-arn <arn>", "IAM role to assume to write to the queue; the printed external id goes in its trust policy")
      .option("--access-key-id <id>", "Static access key id for the queue, as an alternative to a role. Its secret is read from LANGWATCH_SQS_SECRET_ACCESS_KEY, never from an argument")
      .requiredOption("--events <types>", "Comma-separated event types (see: langwatch webhooks event-types)")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (options: {
      url?: string;
      queueUrl?: string;
      roleArn?: string;
      accessKeyId?: string;
      events: string;
    }) => {
      const { createWebhookCommand: impl } = await import("./commands/webhooks/create.js");
      return impl(options);
    },
  );

  emitsResult(
    webhooksCmd
      .command("update <id>")
      .description("Update an endpoint's address, event subscriptions, or delivery controls")
      .option("--url <url>", "New HTTPS receiver URL")
      .option("--queue-url <url>", "New Amazon SQS queue URL (an endpoint keeps the destination kind it was created with)")
      .option("--role-arn <arn>", "New IAM role to assume to write to the queue")
      .option("--access-key-id <id>", "New static access key id for the queue. Its secret is read from LANGWATCH_SQS_SECRET_ACCESS_KEY, never from an argument")
      .option("--events <types>", "New comma-separated event types (replaces the set)")
      .option("--max-batch-size <n>", "Envelopes per POST, 1-100")
      .option("--max-batch-delay <ms>", "Coalescing window in ms before a partial batch ships, 0-60000")
      .option("--max-in-flight <n>", "Concurrent POSTs to the receiver, 1-8")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (
      id: string,
      options: {
        url?: string;
        queueUrl?: string;
        roleArn?: string;
        accessKeyId?: string;
        events?: string;
        maxBatchSize?: string;
        maxBatchDelay?: string;
        maxInFlight?: string;
      },
    ) => {
      const { updateWebhookCommand: impl } = await import("./commands/webhooks/update.js");
      return impl(id, options);
    },
  );

  emitsResult(
    webhooksCmd
      .command("enable <id>")
      .description("Re-enable a disabled endpoint")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (id: string) => {
      const { enableWebhookCommand: impl } = await import("./commands/webhooks/update.js");
      return impl(id);
    },
  );

  emitsResult(
    webhooksCmd
      .command("disable <id>")
      .description("Disable an endpoint (queued deliveries drain without sending)")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (id: string) => {
      const { disableWebhookCommand: impl } = await import("./commands/webhooks/update.js");
      return impl(id);
    },
  );

  emitsResult(
    webhooksCmd
      .command("archive <id>")
      .description("Archive an endpoint (deliveries stop; history stays readable)")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (id: string) => {
      const { archiveWebhookCommand: impl } = await import("./commands/webhooks/archive.js");
      return impl(id);
    },
  );

  emitsResult(
    webhooksCmd
      .command("roll-secret <id>")
      .description("Roll the signing secret; prints the new one ONCE")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (id: string) => {
      const { rollWebhookSecretCommand: impl } = await import("./commands/webhooks/roll-secret.js");
      return impl(id);
    },
  );

  emitsResult(
    webhooksCmd
      .command("test <id>")
      .description("Send a signed test event and report the receiver's answer")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (id: string) => {
      const { testWebhookCommand: impl } = await import("./commands/webhooks/test.js");
      return impl(id);
    },
  );

  emitsResult(
    webhooksCmd
      .command("deliveries <id>")
      .description("The endpoint's delivery log with receiver status codes")
      .option("--cursor <cursor>", "Page cursor from the previous call")
      .option("--limit <n>", "Attempts per page (default 50)")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (id: string, options: { cursor?: string; limit?: string }) => {
      const { webhookDeliveriesCommand: impl } = await import("./commands/webhooks/deliveries.js");
      return impl(id, options);
    },
  );

  emitsResult(
    webhooksCmd
      .command("health <id>")
      .description("Delivery health: status, failure streak, last success")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (id: string) => {
      const { webhookHealthCommand: impl } = await import("./commands/webhooks/health.js");
      return impl(id);
    },
  );

  emitsResult(
    webhooksCmd
      .command("event-types")
      .description("The subscribable event catalog, grouped by family")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async () => {
      const { webhookEventTypesCommand: impl } = await import("./commands/webhooks/events.js");
      return impl();
    },
  );

  emitsResult(
    webhooksCmd
      .command("events")
      .description("The org's emitted-events log (Stripe /v1/events parity)")
      .option("--type <type>", "Filter by event type")
      .option("--from <instant>", "ISO-8601 or epoch ms lower bound")
      .option("--to <instant>", "ISO-8601 or epoch ms upper bound")
      .option("--cursor <cursor>", "Page cursor from the previous call")
      .option("--limit <n>", "Events per page (default 50)")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (options: { type?: string; from?: string; to?: string; cursor?: string; limit?: string }) => {
      const { webhookEventsCommand: impl } = await import("./commands/webhooks/events.js");
      return impl(options);
    },
  );

  // Add spend-events command group (billing reconciliation pull)
  const spendEventsCmd = program
    .command("spend-events")
    .description("Pull the per-request spend record (org API key; enterprise)");

  emitsResult(
    spendEventsCmd
      .command("list")
      .description("Cursor-paged spend events with filters")
      .option("--from <instant>", "ISO-8601 or epoch ms lower bound (occurred-at)")
      .option("--to <instant>", "ISO-8601 or epoch ms upper bound (occurred-at)")
      .option("--cursor <cursor>", "Page cursor from the previous call")
      .option("--limit <n>", "Events per page (default 50, max 200)")
      .option("--virtual-key <id>", "Filter by virtual key")
      .option("--end-user <id>", "Filter by external end-user id")
      .option("--project <id>", "Filter by project")
      .option("--model <model>", "Filter by model")
      .option("--status <status>", "Filter by status: success|error")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (options: {
      from?: string;
      to?: string;
      cursor?: string;
      limit?: string;
      virtualKey?: string;
      endUser?: string;
      project?: string;
      model?: string;
      status?: "success" | "error";
    }) => {
      const { listSpendEventsCommand: impl } = await import("./commands/spend-events/list.js");
      return impl(options);
    },
  );

  emitsResult(
    spendEventsCmd
      .command("replay")
      .description("Re-deliver a window's spend envelopes to one endpoint (7-day cap)")
      .requiredOption("--from <instant>", "ISO-8601 or epoch ms window start")
      .requiredOption("--to <instant>", "ISO-8601 or epoch ms window end")
      .requiredOption("--endpoint <id>", "Webhook endpoint id to replay to")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (options: { from: string; to: string; endpoint: string }) => {
      const { spendReplayCommand: impl } = await import("./commands/spend-events/replay.js");
      return impl(options);
    },
  );

  emitsResult(
    spendEventsCmd
      .command("by-user <endUserId>")
      .description("Windowed spend rollup for one external end user")
      .option("--window <window>", "day|week|month (default month)")
      .option("--virtual-key <id>", "Narrow to one virtual key")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (endUserId: string, options: { window?: "day" | "week" | "month"; virtualKey?: string }) => {
      const { spendByUserCommand: impl } = await import("./commands/spend-events/by-user.js");
      return impl(endUserId, options);
    },
  );

  emitsResult(
    spendEventsCmd
      .command("summary")
      .description("Per-key spend rollups, the reconciliation checksum fast path (settled requests counted separately, never in cost sums)")
      .option("--group-by <keys>", "One or two of virtual_key, end_user, project, model, provider, principal, request_type (comma separated), default virtual_key")
      .option("--bucket <size>", "Add a time column: none (default), hour or day")
      .option("--timezone <zone>", "Zone the time bucket falls on, default UTC")
      .option("--allow-unstable", "Group by model, provider or time over a range still receiving outcomes, accepting approximate totals")
      .option("--from <instant>", "Range start (ISO or unix ms), default 24h ago")
      .option("--to <instant>", "Range end (ISO or unix ms), default now")
      .option("--project <id>", "Narrow to one project")
      .option("--team <id>", "Narrow to the projects one team owns")
      .option("--model <name...>", "Narrow to these models")
      .option("--provider <id...>", "Narrow to these model providers")
      .option("--end-user <id...>", "Narrow to these end users")
      .option("--metadata <pair...>", "Narrow by your own request metadata, written key=value")
      .option("--limit <n>", "Rows fetched per page, default 500. The walk always covers the whole window")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (options: {
      groupBy?: string;
      bucket?: string;
      timezone?: string;
      allowUnstable?: boolean;
      from?: string;
      to?: string;
      project?: string;
      team?: string;
      model?: string[];
      provider?: string[];
      endUser?: string[];
      metadata?: string[];
      limit?: string;
    }) => {
      const { spendSummaryCommand: impl } = await import("./commands/spend-events/summary.js");
      return impl(options);
    },
  );

  // Add annotation command group
  const annotationCmd = program
    .command("annotation")
    .description("Manage trace annotations");

  emitsResult(
    annotationCmd
      .command("list")
      .description("List all annotations (optionally filtered by trace)")
      .option("--trace-id <traceId>", "Filter by trace ID")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (options: { traceId?: string }) => {
      const { listAnnotationsCommand: impl } = await import("./commands/annotations/list.js");
      return impl(options);
    },
  );

  emitsResult(
    annotationCmd
      .command("get <id>")
      .description("Get annotation details by ID")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (id: string) => {
      const { getAnnotationCommand: impl } = await import("./commands/annotations/get.js");
      return impl(id);
    },
  );

  emitsResult(
    annotationCmd
      .command("create <traceId>")
      .description("Create an annotation for a trace")
      .option("--comment <comment>", "Annotation comment")
      .option("--thumbs-up", "Mark as thumbs up")
      .option("--thumbs-down", "Mark as thumbs down")
      .option("--email <email>", "Email of the annotator")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (traceId: string, options: { comment?: string; thumbsUp?: boolean; thumbsDown?: boolean; email?: string }) => {
      const { createAnnotationCommand: impl } = await import("./commands/annotations/create.js");
      return impl(traceId, options);
    },
  );

  emitsResult(
    annotationCmd
      .command("delete <id>")
      .description("Delete an annotation")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (id: string) => {
      const { deleteAnnotationCommand: impl } = await import("./commands/annotations/delete.js");
      return impl(id);
    },
  );

  // Add analytics command group
  const analyticsCmd = program
    .command("analytics")
    .description("Query analytics and metrics");

  emitsResult(
    analyticsCmd
      .command("query")
      .description("Query timeseries analytics (costs, latency, token usage, etc.)")
      .option("-m, --metric <metric>", "Metric to query (preset name or raw metric path, default: trace-count)")
      .option("-a, --aggregation <aggregation>", "Aggregation type: cardinality, avg, sum, min, max, p95, p99")
      .option("--start-date <date>", "Start date (ISO string, default: 7 days ago)")
      .option("--end-date <date>", "End date (ISO string, default: now)")
      .option("--group-by <field>", "Group by field (e.g. metadata.model)")
      .option("--time-scale <scale>", "Time scale: 'full' for aggregate, or interval in seconds")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (options: { metric?: string; aggregation?: string; startDate?: string; endDate?: string; groupBy?: string; timeScale?: string }) => {
      const { queryAnalyticsCommand: impl } = await import("./commands/analytics/query.js");
      return impl(options);
    },
  );

  // Add trace command group
  const traceCmd = program
    .command("trace")
    .description("Search and inspect traces");

  /**
   * Help for `--project`, shared by every command that reads across projects.
   * The default is the personal project, which is where these commands pointed
   * before the flag existed, so an existing script keeps its meaning.
   */
  const PROJECT_FLAG_HELP =
    "Project to read from, by id or slug (default: your personal project). Needs a login that reaches it; `langwatch projects list` shows which ones do";

  rendersOwnResult(
    traceCmd
      .command("search")
      .description("Search traces with optional text query and date range")
      .option(
        "-q, --query <query>",
        "Text search query. Plain text only: AND, OR and NOT are matched as words, not as operators",
      )
      .option("--start-date <date>", "Start date (ISO string or epoch ms, default: 24h ago)")
      .option("--end-date <date>", "End date (ISO string or epoch ms, default: now)")
      .option("--limit <n>", "Max results to return (default: 25)")
      .option(
        "--origin <origins>",
        "Filter by trace origin, comma-separated (e.g. application,evaluation,simulation,playground,langy); 'application' includes traces with no recorded origin",
      )
      .option(
        "--errors-only",
        "Only traces that contain an error. The error is on the span, not in the searchable text, so this is the way to find failures",
      )
      .option("--project <idOrSlug>", PROJECT_FLAG_HELP)
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
  ).action(async (_options: unknown, command: Command) => {
    const { searchTracesCommand: impl } = await import("./commands/traces/search.js");
    // Merged globals: `printResult` resolves the format from what it is handed,
    // and commander puts a root-position `--output` only on the ROOT, so the
    // leaf's own opts would silently drop the flag the caller passed.
    await impl(command.optsWithGlobals());
  });

  traceCmd
    .command("export")
    .description("Export traces as CSV, JSONL, or JSON")
    .option("--start-date <date>", "Start date (ISO string, default: 7 days ago)")
    .option("--end-date <date>", "End date (ISO string, default: now)")
    .option(
      "-q, --query <query>",
      "Text search query to filter traces. Plain text only: AND, OR and NOT are matched as words, not as operators",
    )
    .option(
      "--origin <origins>",
      "Filter by trace origin, comma-separated (e.g. application,evaluation,simulation,playground,langy); 'application' includes traces with no recorded origin",
    )
    .option(
      "--errors-only",
      "Only traces that contain an error. The error is on the span, not in the searchable text, so this is the way to find failures",
    )
    .option("-f, --format <format>", "Output format: jsonl (default), csv, or json", "jsonl")
    .option("-o, --output <file>", "Write output to file instead of stdout")
    .option("--limit <n>", "Max traces to export (default: 1000); limits above one server page are fetched by cursor paging")
    .option("--include-spans", "Include full span data for each trace (slower, larger output)")
    .option("--project <idOrSlug>", PROJECT_FLAG_HELP)
    .action(async (options: { startDate?: string; endDate?: string; query?: string; origin?: string; format?: string; output?: string; limit?: string; includeSpans?: boolean; project?: string }) => {
      const { exportTracesCommand: impl } = await import("./commands/traces/export.js");
      await impl(options);
    });

  rendersOwnResult(
    traceCmd
      .command("get <traceId>")
      .description("Get full trace details by ID")
      .option("--project <idOrSlug>", PROJECT_FLAG_HELP)
      .option("-f, --format <format>", "Output format: digest (default, human-readable) or json", "digest"),
  ).action(async (traceId: string, _options: unknown, command: Command) => {
    const { getTraceCommand: impl } = await import("./commands/traces/get.js");
    await impl(traceId, command.optsWithGlobals());
  });

  rendersOwnResult(
    traceCmd
      .command("transcript <traceId>")
      .description("Print the coding-agent transcript of a trace (what the agent did, in order)")
      .option("--project <idOrSlug>", PROJECT_FLAG_HELP)
      .option("-f, --format <format>", "Output format: table (default, human-readable) or json", "table"),
  ).action(async (traceId: string, _options: unknown, command: Command) => {
    const { transcriptTraceCommand: impl } = await import("./commands/traces/transcript.js");
    await impl(traceId, command.optsWithGlobals());
  });

  // Add session command group
  const sessionCmd = program
    .command("session")
    .description("Inspect coding-agent sessions");

  rendersOwnResult(
    sessionCmd
      .command("events <sessionId>")
      .description("List a coding-agent session's events (model calls, compactions, rate limits, tool runs) in time order")
      .option("--kinds <kinds>", "Comma-separated event kinds to include (e.g. model_call,compaction,rate_limit)")
      .option("--limit <n>", "Max events to return (default: 500); larger limits are fetched by cursor paging")
      .option("--from <date>", "Start date (ISO string or epoch ms); with --to, prunes storage partitions for faster reads")
      .option("--to <date>", "End date (ISO string or epoch ms)")
      .option("--project <idOrSlug>", PROJECT_FLAG_HELP)
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
  ).action(async (sessionId: string, _options: unknown, command: Command) => {
    const { sessionEventsCommand: impl } = await import("./commands/sessions/events.js");
    await impl(sessionId, command.optsWithGlobals());
  });

  // Add scenario command group
  const scenarioCmd = program
    .command("scenario")
    .description("Manage scenarios");

  emitsResult(
    scenarioCmd
      .command("list")
      .description("List all scenarios in the project")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async () => {
      const { listScenariosCommand: impl } = await import("./commands/scenarios/list.js");
      return impl();
    },
  );

  emitsResult(
    scenarioCmd
      .command("get <id>")
      .description("Get scenario details by ID")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (id: string) => {
      const { getScenarioCommand: impl } = await import("./commands/scenarios/get.js");
      return impl(id);
    },
  );

  emitsResult(
    scenarioCmd
      .command("create <name>")
      .description("Create a new scenario")
      .requiredOption("--situation <situation>", "The situation/context for the scenario")
      .option("--criteria <criteria>", "Comma-separated list of evaluation criteria")
      .option("--labels <labels>", "Comma-separated list of labels")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (name: string, options: { situation: string; criteria?: string; labels?: string }) => {
      const { createScenarioCommand: impl } = await import("./commands/scenarios/create.js");
      return impl(name, options);
    },
  );

  emitsResult(
    scenarioCmd
      .command("update <id>")
      .description("Update an existing scenario")
      .option("--name <name>", "New scenario name")
      .option("--situation <situation>", "New situation/context")
      .option("--criteria <criteria>", "New comma-separated list of criteria (replaces existing)")
      .option("--labels <labels>", "New comma-separated list of labels (replaces existing)")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (id: string, options: { name?: string; situation?: string; criteria?: string; labels?: string }) => {
      const { updateScenarioCommand: impl } = await import("./commands/scenarios/update.js");
      return impl(id, options);
    },
  );

  scenarioCmd
    .command("run <id>")
    .description("Run a scenario against a target (agent or prompt)")
    .requiredOption("--target <target>", "Target to run against, as <type>:<referenceId> (e.g., http:agent_abc123)")
    .option("--wait", "Wait for the scenario run to complete")
    .option("--param <pair>", PARAM_FLAG_HELP, collectParam)
    .option("-f, --format <format>", "Output format: table (default) or json", "table")
    .action(async (id: string, options: { target: string; wait?: boolean; format?: string; param?: string[] }) => {
      const { runScenarioCommand: impl } = await import("./commands/scenarios/run.js");
      await impl(id, options);
    });

  emitsResult(
    scenarioCmd
      .command("delete <id>")
      .description("Archive (soft-delete) a scenario")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (id: string) => {
      const { deleteScenarioCommand: impl } = await import("./commands/scenarios/delete.js");
      return impl(id);
    },
  );

  // Add suite (run plan) command group
  const suiteCmd = program
    .command("suite")
    .description("Manage suites (run plans) — scenario × target execution plans");

  emitsResult(
    suiteCmd
      .command("list")
      .description("List all suites in the project")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async () => {
      const { listSuitesCommand: impl } = await import("./commands/suites/list.js");
      return impl();
    },
  );

  emitsResult(
    suiteCmd
      .command("get <id>")
      .description("Get suite details by ID")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (id: string) => {
      const { getSuiteCommand: impl } = await import("./commands/suites/get.js");
      return impl(id);
    },
  );

  emitsResult(
    suiteCmd
      .command("create <name>")
      .description("Create a new suite (run plan)")
      .requiredOption("--scenarios <ids>", "Comma-separated scenario IDs")
      .requiredOption("--targets <targets...>", "Targets as <type>:<referenceId> (e.g., http:agent_abc)")
      .option("--repeat-count <n>", "Number of times to repeat each scenario-target pair", "1")
      .option("--labels <labels>", "Comma-separated labels")
      .option("--description <desc>", "Suite description")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (name: string, options: { scenarios?: string; targets?: string[]; repeatCount?: string; labels?: string; description?: string }) => {
      const { createSuiteCommand: impl } = await import("./commands/suites/create.js");
      return impl(name, options);
    },
  );

  emitsResult(
    suiteCmd
      .command("update <id>")
      .description("Update a suite (run plan)")
      .option("--name <name>", "New suite name")
      .option("--scenarios <ids>", "New comma-separated scenario IDs")
      .option("--targets <targets...>", "New targets as <type>:<referenceId>")
      .option("--repeat-count <n>", "New repeat count")
      .option("--labels <labels>", "New comma-separated labels")
      .option("--description <desc>", "New description")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (id: string, options: { name?: string; scenarios?: string; targets?: string[]; repeatCount?: string; labels?: string; description?: string }) => {
      const { updateSuiteCommand: impl } = await import("./commands/suites/update.js");
      return impl(id, options);
    },
  );

  emitsResult(
    suiteCmd
      .command("duplicate <id>")
      .description("Duplicate a suite")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (id: string) => {
      const { duplicateSuiteCommand: impl } = await import("./commands/suites/duplicate.js");
      return impl(id);
    },
  );

  suiteCmd
    .command("run <id>")
    .description("Execute a suite run — schedules all scenario × target × repeat jobs")
    .option("--wait", "Wait for the suite run to complete before returning")
    .option("--param <pair>", PARAM_FLAG_HELP, collectParam)
    .option("-f, --format <format>", "Output format: table (default) or json", "table")
    .action(async (id: string, options: { wait?: boolean; format?: string; param?: string[] }) => {
      const { runSuiteCommand: impl } = await import("./commands/suites/run.js");
      await impl({ id, options });
    });

  emitsResult(
    suiteCmd
      .command("delete <id>")
      .description("Archive (soft-delete) a suite")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (id: string) => {
      const { deleteSuiteCommand: impl } = await import("./commands/suites/delete.js");
      return impl(id);
    },
  );

  // Add graph command group
  const graphCmd = program
    .command("graph")
    .description("Manage custom graphs on dashboards");

  emitsResult(
    graphCmd
      .command("list")
      .description("List all custom graphs (optionally filter by dashboard)")
      .option("--dashboard-id <id>", "Filter by dashboard ID")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (options: { dashboardId?: string }) => {
      const { listGraphsCommand: impl } = await import("./commands/graphs/list.js");
      return impl(options);
    },
  );

  emitsResult(
    graphCmd
      .command("get <id>")
      .description("Get a custom graph by ID")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (id: string) => {
      const { getGraphCommand: impl } = await import("./commands/graphs/get.js");
      return impl(id);
    },
  );

  emitsResult(
    graphCmd
      .command("create <name>")
      .description("Create a custom graph")
      .option("--dashboard-id <id>", "Dashboard to add the graph to")
      .option("--graph <json>", "Graph definition as JSON")
      .option("--filters <json>", "Filter conditions as JSON")
      .option("--col-span <n>", "Column span (1-2)")
      .option("--row-span <n>", "Row span (1-2)")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (name: string, options: { dashboardId?: string; graph?: string; filters?: string; colSpan?: string; rowSpan?: string }) => {
      const { createGraphCommand: impl } = await import("./commands/graphs/create.js");
      return impl(name, options);
    },
  );

  emitsResult(
    graphCmd
      .command("update <id>")
      .description("Update a custom graph")
      .option("--name <name>", "New graph name")
      .option("--graph <json>", "New graph definition as JSON")
      .option("--filters <json>", "New filter conditions as JSON")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (id: string, options: { name?: string; graph?: string; filters?: string }) => {
      const { updateGraphCommand: impl } = await import("./commands/graphs/update.js");
      return impl(id, options);
    },
  );

  emitsResult(
    graphCmd
      .command("delete <id>")
      .description("Delete a custom graph")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (id: string) => {
      const { deleteGraphCommand: impl } = await import("./commands/graphs/delete.js");
      return impl(id);
    },
  );

  // Add trigger (automation) command group
  const triggerCmd = program
    .command("trigger")
    .description("Manage triggers (automations) — alerts, webhooks, and dataset actions");

  emitsResult(
    triggerCmd
      .command("list")
      .description("List all triggers in the project")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async () => {
      const { listTriggersCommand: impl } = await import("./commands/triggers/list.js");
      return impl();
    },
  );

  emitsResult(
    triggerCmd
      .command("get <id>")
      .description("Get trigger details by ID")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (id: string) => {
      const { getTriggerCommand: impl } = await import("./commands/triggers/get.js");
      return impl(id);
    },
  );

  emitsResult(
    triggerCmd
      .command("create <name>")
      .description("Create a new trigger (automation)")
      .requiredOption("--action <action>", "Trigger action: SEND_EMAIL, ADD_TO_DATASET, ADD_TO_ANNOTATION_QUEUE, SEND_SLACK_MESSAGE")
      .option("--filters <json>", "Trigger filter conditions as JSON")
      .option("--message <text>", "Custom alert message")
      .option("--alert-type <type>", "Alert severity: CRITICAL, WARNING, INFO")
      .option("--slack-webhook <url>", "Slack webhook URL (for SEND_SLACK_MESSAGE action)")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (name: string, options: { action: string; filters?: string; message?: string; alertType?: string; slackWebhook?: string }) => {
      const { createTriggerCommand: impl } = await import("./commands/triggers/create.js");
      return impl(name, options);
    },
  );

  emitsResult(
    triggerCmd
      .command("update <id>")
      .description("Update a trigger")
      .option("--name <name>", "New trigger name")
      .option("--active <boolean>", "Enable or disable the trigger (true/false)")
      .option("--message <text>", "New alert message")
      .option("--alert-type <type>", "New alert severity")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (id: string, options: { name?: string; active?: string; message?: string; alertType?: string }) => {
      const { updateTriggerCommand: impl } = await import("./commands/triggers/update.js");
      return impl(id, options);
    },
  );

  emitsResult(
    triggerCmd
      .command("delete <id>")
      .description("Delete a trigger")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (id: string) => {
      const { deleteTriggerCommand: impl } = await import("./commands/triggers/delete.js");
      return impl(id);
    },
  );

  // Add secret command group
  const secretCmd = program
    .command("secret")
    .description("Manage project secrets — encrypted environment variables for agents");

  emitsResult(
    secretCmd
      .command("list")
      .description("List all secrets in the project (values are never shown)")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async () => {
      const { listSecretsCommand: impl } = await import("./commands/secrets/list.js");
      return impl();
    },
  );

  emitsResult(
    secretCmd
      .command("get <id>")
      .description("Get secret metadata by ID (value is never shown)")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (id: string) => {
      const { getSecretCommand: impl } = await import("./commands/secrets/get.js");
      return impl(id);
    },
  );

  emitsResult(
    secretCmd
      .command("create <name>")
      .description("Create a new secret (name must be UPPER_SNAKE_CASE)")
      .requiredOption("--value <value>", "The secret value (will be encrypted)")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (name: string, options: { value: string }) => {
      const { createSecretCommand: impl } = await import("./commands/secrets/create.js");
      return impl(name, options);
    },
  );

  emitsResult(
    secretCmd
      .command("update <id>")
      .description("Update a secret's value")
      .requiredOption("--value <value>", "The new secret value (will be encrypted)")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (id: string, options: { value: string }) => {
      const { updateSecretCommand: impl } = await import("./commands/secrets/update.js");
      return impl(id, options);
    },
  );

  emitsResult(
    secretCmd
      .command("delete <id>")
      .description("Delete a secret")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (id: string) => {
      const { deleteSecretCommand: impl } = await import("./commands/secrets/delete.js");
      return impl(id);
    },
  );

  // Add monitor (online evaluation) command group
  const monitorCmd = program
    .command("monitor")
    .description("Manage online evaluation monitors — evaluators running on incoming traces");

  emitsResult(
    monitorCmd
      .command("list")
      .description("List all monitors in the project")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async () => {
      const { listMonitorsCommand: impl } = await import("./commands/monitors/list.js");
      return impl();
    },
  );

  emitsResult(
    monitorCmd
      .command("get <id>")
      .description("Get monitor details by ID")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (id: string) => {
      const { getMonitorCommand: impl } = await import("./commands/monitors/get.js");
      return impl(id);
    },
  );

  emitsResult(
    monitorCmd
      .command("create <name>")
      .description("Create a new online evaluation monitor")
      .requiredOption("--check-type <type>", "Evaluator check type (e.g. ragas/toxicity, custom/my-eval)")
      .option("--execution-mode <mode>", "Execution mode: ON_MESSAGE (default), AS_GUARDRAIL, MANUALLY", "ON_MESSAGE")
      .option("--sample <rate>", "Sampling rate 0.0-1.0 (default: 1.0)")
      .option("--evaluator-id <id>", "Saved evaluator to run (required; see `langwatch evaluator list`)")
      .option("--level <level>", "Evaluation level: trace (default) or thread")
      .option("--parameters <json>", "Evaluator settings as JSON")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (name: string, options: { checkType: string; executionMode?: string; sample?: string; evaluatorId?: string; level?: string; parameters?: string }) => {
      const { createMonitorCommand: impl } = await import("./commands/monitors/create.js");
      return impl(name, options);
    },
  );

  emitsResult(
    monitorCmd
      .command("update <id>")
      .description("Update a monitor")
      .option("--name <name>", "New monitor name")
      .option("--enabled <boolean>", "Enable or disable the monitor (true/false)")
      .option("--execution-mode <mode>", "Execution mode: ON_MESSAGE, AS_GUARDRAIL, MANUALLY")
      .option("--sample <rate>", "Sampling rate 0.0-1.0")
      .option("--parameters <json>", "Updated evaluator settings as JSON")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (id: string, options: { name?: string; enabled?: string; executionMode?: string; sample?: string; parameters?: string }) => {
      const { updateMonitorCommand: impl } = await import("./commands/monitors/update.js");
      return impl(id, options);
    },
  );

  emitsResult(
    monitorCmd
      .command("delete <id>")
      .description("Delete a monitor")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (id: string) => {
      const { deleteMonitorCommand: impl } = await import("./commands/monitors/delete.js");
      return impl(id);
    },
  );

  // Add simulation-run command group
  const simulationRunCmd = program
    .command("simulation-run")
    .description("View simulation run results");

  emitsResult(
    simulationRunCmd
      .command("list")
      .description("List simulation runs (optionally filter by scenario set or batch)")
      .option("--scenario-set-id <id>", "Filter by scenario set ID")
      .option("--batch-run-id <id>", "Filter by batch run ID (requires --scenario-set-id)")
      .option("--status <status>", "Filter by status (e.g. SUCCESS, FAILED, ERROR, IN_PROGRESS)")
      .option("--name <substring>", "Filter by run name substring (case-insensitive)")
      .option("--limit <n>", "Max results (default: 20)")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (options: { scenarioSetId?: string; batchRunId?: string; status?: string; name?: string; limit?: string }) => {
      const { listSimulationRunsCommand: impl } = await import("./commands/simulation-runs/list.js");
      return impl(options);
    },
  );

  emitsResult(
    simulationRunCmd
      .command("get <runId>")
      .description("Get full details of a simulation run (messages, results, costs)")
      .option("--full", "Show full message content instead of truncating long lines")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (runId: string, options: { full?: boolean }) => {
      const { getSimulationRunCommand: impl } = await import("./commands/simulation-runs/get.js");
      return impl(runId, options);
    },
  );

  // Ask the platform to open, in the user's browser, a resource this
  // conversation already looked up. Carries only the resource's id — never
  // an address; the platform resolves where it actually lives from the link
  // it remembered surfacing. See specs/langy/langy-agent-driven-navigation.feature.
  const navigateCmd = program
    .command("navigate")
    .description(
      "Ask the platform to open a resource this conversation already looked up",
    );

  navigateCmd
    .command("open <resourceId>")
    .description("Open a previously looked-up resource by id")
    .action(async (resourceId: string) => {
      const { navigateOpenCommand: impl } = await import("./commands/navigate/open.js");
      await impl(resourceId);
    });

  // Drive the page the user has open with typed UI actions. Agent plumbing
  // like `navigate`: only works mid-turn, when the platform can reach the
  // page over the turn's live stream. See specs/langy/langy-ui-actions.feature.
  const uiCmd = program
    .command("ui")
    .description("Drive the page the user has open with typed actions");

  emitsResult(
    uiCmd
      .command("call <kind>")
      .description("Dispatch one UI action to the open page and print its result")
      .option("--payload <json>", "The action's payload as JSON (default: {})")
      .option(
        "--payload-file <path>",
        "Read the payload from a file, or from stdin with -. Use this for prompts and any other text a shell would mangle",
      )
      .option(
        "--experiment <slug>",
        "Experiment for the backend fallback to apply the action to when no page answers",
      )
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (
      kind: string,
      options: { payload?: string; payloadFile?: string; experiment?: string },
    ) => {
      const { uiCallCommand: impl } = await import("./commands/ui/call.js");
      return impl(kind, options);
    },
  );

  emitsResult(
    uiCmd
      .command("actions")
      .description("List the UI actions pages accept, with their schemas")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async () => {
      const { uiActionsCommand: impl } = await import("./commands/ui/actions.js");
      return impl();
    },
  );

  const workbenchCmd = program
    .command("workbench")
    .description("Work with the evaluations workbench the user has open");

  emitsResult(
    workbenchCmd
      .command("get-state [experiment]")
      .description(
        "Read the open workbench as the user sees it, unsaved edits included; with the experiment named it answers from the saved state when no page is open",
      )
      .option("--no-include-results", "Leave the results summary out")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (
      experiment: string | undefined,
      options: { includeResults?: boolean },
    ) => {
      const { workbenchGetStateCommand: impl } = await import(
        "./commands/workbench/get-state.js"
      );
      return impl(experiment, options);
    },
  );

  // Add dataset command group
  const datasetCmd = program
    .command("dataset")
    .description("Manage datasets");

  emitsResult(
    datasetCmd
      .command("list")
      .description("List all datasets")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async () => {
      const { listCommand: listDatasetsImpl } = await import("./commands/dataset/list.js");
      return listDatasetsImpl();
    },
  );

  emitsResult(
    datasetCmd
      .command("create <name>")
      .description("Create a new dataset")
      .option("-c, --columns <columns>", "Column definitions (e.g. input:string,output:string)")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (name: string, options: { columns?: string }) => {
      const { createCommand: createDatasetImpl } = await import("./commands/dataset/create.js");
      return createDatasetImpl(name, options);
    },
  );

  emitsResult(
    datasetCmd
      .command("get <slugOrId>")
      .description("Get dataset details and preview records")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (slugOrId: string) => {
      const { getCommand: getDatasetImpl } = await import("./commands/dataset/get.js");
      return getDatasetImpl(slugOrId);
    },
  );

  emitsResult(
    datasetCmd
      .command("delete <slugOrId>")
      .description("Delete (archive) a dataset")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (slugOrId: string) => {
      const { deleteCommand: deleteDatasetImpl } = await import("./commands/dataset/delete.js");
      return deleteDatasetImpl(slugOrId);
    },
  );

  emitsResult(
    datasetCmd
      .command("upload <slug> <file>")
      .description("Upload a file to a dataset (creates if not found)")
      .option("--if-exists <strategy>", "Strategy when dataset exists: append (default), replace, error"),
    async (slug: string, file: string, options: { ifExists?: string }) => {
      const { uploadCommand: uploadDatasetImpl } = await import("./commands/dataset/upload.js");
      return uploadDatasetImpl(slug, file, options);
    },
  );

  datasetCmd
    .command("download <slugOrId>")
    .description("Download dataset records as CSV or JSONL")
    .option("-f, --format <format>", "Output format: csv or jsonl", "csv")
    .action(async (slugOrId: string, options: { format?: string }) => {
      const { downloadCommand: downloadDatasetImpl } = await import("./commands/dataset/download.js");
      await downloadDatasetImpl(slugOrId, options);
    });

  emitsResult(
    datasetCmd
      .command("update <slugOrId>")
      .description("Update a dataset name or columns")
      .option("--name <name>", "New dataset name")
      .option("--columns <columns>", "New column definitions (e.g. input:string,output:string)")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (slugOrId: string, options: { name?: string; columns?: string }) => {
      const { updateCommand: updateDatasetImpl } = await import("./commands/dataset/update.js");
      return updateDatasetImpl(slugOrId, options);
    },
  );

  // Records subcommand group
  const recordsCmd = datasetCmd
    .command("records")
    .description("Manage dataset records");

  emitsResult(
    recordsCmd
      .command("list <slugOrId>")
      .description("List records in a dataset")
      .option("--page <n>", "Page number (default: 1)")
      .option("--limit <n>", "Records per page (default: 20)")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (slugOrId: string, options: { page?: string; limit?: string }) => {
      const { recordsListCommand } = await import("./commands/dataset/records-list.js");
      return recordsListCommand(slugOrId, options);
    },
  );

  emitsResult(
    recordsCmd
      .command("add <slugOrId>")
      .description("Add records to a dataset")
      .option("--json <json>", "JSON array of records (inline)")
      .option("--file <path>", "Read JSON array of records from a file")
      .option("--stdin", "Read JSON array from stdin")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (slugOrId: string, options: { json?: string; file?: string; stdin?: boolean }) => {
      const { recordsAddCommand } = await import("./commands/dataset/records-add.js");
      return recordsAddCommand(slugOrId, options);
    },
  );

  emitsResult(
    recordsCmd
      .command("update <slugOrId> <recordId>")
      .description("Update a single record in a dataset")
      .requiredOption("--json <json>", "JSON object with updated fields")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (slugOrId: string, recordId: string, options: { json: string }) => {
      const { recordsUpdateCommand } = await import("./commands/dataset/records-update.js");
      return recordsUpdateCommand(slugOrId, recordId, options);
    },
  );

  emitsResult(
    recordsCmd
      .command("delete <slugOrId> <recordIds...>")
      .description("Delete records from a dataset")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (slugOrId: string, recordIds: string[]) => {
      const { recordsDeleteCommand } = await import("./commands/dataset/records-delete.js");
      return recordsDeleteCommand(slugOrId, recordIds);
    },
  );
  const projectsCmd = program
    .command("projects")
    .description("Manage organization projects");

  emitsResult(
    projectsCmd
      .command("list")
      .description("List all projects in the organization")
      .option("--page <page>", "Page number", "1")
      .option("--limit <limit>", "Items per page", "50")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (options: { page?: string; limit?: string }) => {
      const { listProjectsCommand: impl } = await import("./commands/projects/list.js");
      return impl({
        page: options.page ? Number(options.page) : undefined,
        limit: options.limit ? Number(options.limit) : undefined,
      });
    },
  );

  emitsResult(
    projectsCmd
      .command("get <id>")
      .description("Show details for a project")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (id: string) => {
      const { getProjectCommand: impl } = await import("./commands/projects/get.js");
      return impl(id);
    },
  );

  emitsResult(
    projectsCmd
      .command("create")
      .description("Create a new project (returns a one-time service API key)")
      .requiredOption("--name <name>", "Project name")
      .requiredOption("--language <lang>", "Programming language (e.g. python, typescript)")
      .requiredOption("--framework <fw>", "Framework (e.g. langchain, openai, vercel-ai)")
      .option("--team-id <id>", "Existing team ID to assign the project to")
      .option("--new-team-name <name>", "Create a new team with this name")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (options: {
      name: string;
      language: string;
      framework: string;
      teamId?: string;
      newTeamName?: string;
    }) => {
      const { createProjectCommand: impl } = await import("./commands/projects/create.js");
      return impl(options);
    },
  );

  emitsResult(
    projectsCmd
      .command("update <id>")
      .description("Update a project's metadata")
      .option("--name <name>", "New project name")
      .option("--language <lang>", "New language")
      .option("--framework <fw>", "New framework")
      .option("--pii-redaction-level <level>", "PII redaction: STRICT, ESSENTIAL, or DISABLED")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (id: string, options: {
      name?: string;
      language?: string;
      framework?: string;
      piiRedactionLevel?: "STRICT" | "ESSENTIAL" | "DISABLED";
    }) => {
      const { updateProjectCommand: impl } = await import("./commands/projects/update.js");
      return impl(id, options);
    },
  );

  emitsResult(
    projectsCmd
      .command("delete <id>")
      .description("Archive a project (soft-delete)")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (id: string) => {
      const { deleteProjectCommand: impl } = await import("./commands/projects/delete.js");
      return impl(id);
    },
  );

  const apiKeysCmd = program
    .command("api-keys")
    .description("Manage organization API keys");

  emitsResult(
    apiKeysCmd
      .command("list")
      .description("List all API keys in the organization")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async () => {
      const { listApiKeysCommand: impl } = await import("./commands/api-keys/list.js");
      return impl();
    },
  );

  emitsResult(
    apiKeysCmd
      .command("create")
      .description("Create a new API key (token is shown once)")
      .requiredOption("--name <name>", "Human-readable name for the key")
      .option("--key-type <type>", "Key type: personal or service", "service")
      .option("--description <desc>", "Optional description")
      .option("--expires-at <date>", "Expiration date (ISO 8601)")
      .option("--project-id <id...>", "Project IDs to scope the key to (service keys only, repeatable)")
      .option(
        "--binding <binding...>",
        "What the key may reach, as role:scopeType:scopeId (repeatable), for example ADMIN:PROJECT:project_abc",
      )
      .option(
        "--permission <permission...>",
        "Restricted keys only: a permission as resource:action (repeatable)",
      )
      .option(
        "--permission-mode <mode>",
        "How the bindings are read: all, readonly or restricted",
      )
      .option(
        "--assigned-to-user-id <userId>",
        "Organization admins only: the member the key acts as, and is capped by",
      )
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (options: {
      name: string;
      keyType?: "personal" | "service";
      description?: string;
      expiresAt?: string;
      projectId?: string[];
      binding?: string[];
      permission?: string[];
      permissionMode?: string;
      assignedToUserId?: string;
    }) => {
      const { createApiKeyCommand: impl } = await import("./commands/api-keys/create.js");
      return impl(options);
    },
  );

  emitsResult(
    apiKeysCmd
      .command("get <id>")
      .description("Get an API key and the access it carries")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (id: string) => {
      const { getApiKeyCommand: impl } = await import("./commands/api-keys/get.js");
      return impl(id);
    },
  );

  emitsResult(
    apiKeysCmd
      .command("update <id>")
      .description("Update an API key's name, description or access")
      .option("--name <name>", "New name for the key")
      .option("--description <desc>", "New description")
      .option(
        "--binding <binding...>",
        "Replace the key's bindings with exactly these, as role:scopeType:scopeId (repeatable)",
      )
      .option(
        "--permission <permission...>",
        "Restricted keys only: a permission as resource:action (repeatable)",
      )
      .option(
        "--permission-mode <mode>",
        "How the bindings are read: all, readonly or restricted",
      )
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (
      id: string,
      options: {
        name?: string;
        description?: string;
        binding?: string[];
        permission?: string[];
        permissionMode?: string;
      },
    ) => {
      const { updateApiKeyCommand: impl } = await import("./commands/api-keys/update.js");
      return impl({ id, options });
    },
  );

  emitsResult(
    apiKeysCmd
      .command("revoke <id>")
      .description("Revoke an API key (cannot be reactivated)")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (id: string) => {
      const { revokeApiKeyCommand: impl } = await import("./commands/api-keys/revoke.js");
      return impl(id);
    },
  );

  // ── Organization management ────────────────────────────────────────────────
  // The families that provision an organization: the organization itself, its
  // members and invites, teams, groups, custom roles, role bindings, SCIM
  // tokens, and (self-hosted) the organizations on the instance. All of them
  // take an organization API key and are available on Enterprise plans, except
  // `organizations`, which provisions the organization an API key would belong
  // to and so authenticates against the instance instead.

  const organizationCmd = program
    .command("organization")
    .description("Read and update the organization profile");

  emitsResult(
    organizationCmd
      .command("get")
      .description("Get the organization the credential belongs to")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async () => {
      const { getOrganizationCommand: impl } = await import("./commands/organization/get.js");
      return impl();
    },
  );

  emitsResult(
    organizationCmd
      .command("update")
      .description("Update the organization profile")
      .option("--name <name>", "New organization name")
      .option("--support-contact <contact>", "Support contact shown to members")
      .option("--presence", "Turn presence indicators on")
      .option("--no-presence", "Turn presence indicators off")
      .option("--trace-sharing", "Allow sharing traces outside the organization")
      .option("--no-trace-sharing", "Stop sharing traces outside the organization")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (options: {
      name?: string;
      supportContact?: string;
      presence?: boolean;
      traceSharing?: boolean;
    }) => {
      const { updateOrganizationCommand: impl } = await import("./commands/organization/update.js");
      return impl({
        ...(options.name !== undefined ? { name: options.name } : {}),
        ...(options.supportContact !== undefined
          ? { supportContact: options.supportContact }
          : {}),
        ...(options.presence !== undefined
          ? { presenceEnabled: options.presence }
          : {}),
        ...(options.traceSharing !== undefined
          ? { traceSharingEnabled: options.traceSharing }
          : {}),
      });
    },
  );

  const membersCmd = program
    .command("members")
    .description("Manage the people in the organization");

  emitsResult(
    membersCmd
      .command("list")
      .description("List organization members with their role and status")
      .option("--include-disabled", "Include members whose access is disabled")
      .option("--offset <n>", "Skip this many members")
      .option("--limit <n>", "Members per page (default 50, max 200)")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (options: { includeDisabled?: boolean; offset?: string; limit?: string }) => {
      const { listMembersCommand: impl } = await import("./commands/members/list.js");
      return impl(options);
    },
  );

  emitsResult(
    membersCmd
      .command("get <userId>")
      .description("Get one member and the teams they reach")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (userId: string) => {
      const { getMemberCommand: impl } = await import("./commands/members/get.js");
      return impl(userId);
    },
  );

  emitsResult(
    membersCmd
      .command("update <userId>")
      .description("Change a member's organization role")
      .requiredOption("--role <role>", "Organization role to set: ADMIN, MEMBER or EXTERNAL")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (userId: string, options: { role: string }) => {
      const { updateMemberCommand: impl } = await import("./commands/members/update.js");
      return impl({ userId, options });
    },
  );

  emitsResult(
    membersCmd
      .command("disable <userId>")
      .description("Disable a member's access without removing them")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (userId: string) => {
      const { disableMemberCommand: impl } = await import("./commands/members/set-disabled.js");
      return impl(userId);
    },
  );

  emitsResult(
    membersCmd
      .command("enable <userId>")
      .description("Re-enable a disabled member (consumes a seat)")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (userId: string) => {
      const { enableMemberCommand: impl } = await import("./commands/members/set-disabled.js");
      return impl(userId);
    },
  );

  emitsResult(
    membersCmd
      .command("remove <userId>")
      .description("Remove a member from the organization and its teams")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (userId: string) => {
      const { removeMemberCommand: impl } = await import("./commands/members/remove.js");
      return impl(userId);
    },
  );

  emitsResult(
    membersCmd
      .command("access <userId>")
      .description("Show everything a member can reach and where it comes from")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (userId: string) => {
      const { memberAccessCommand: impl } = await import("./commands/members/access.js");
      return impl(userId);
    },
  );

  const invitesCmd = program
    .command("invites")
    .description("Invite people into the organization");

  emitsResult(
    invitesCmd
      .command("list")
      .description("List pending invites with their acceptance links")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async () => {
      const { listInvitesCommand: impl } = await import("./commands/invites/list.js");
      return impl();
    },
  );

  emitsResult(
    invitesCmd
      .command("create")
      .description("Create invites from flags or from a JSON batch")
      .option("--email <email...>", "Email address to invite (repeatable)")
      .option(
        "--role <role...>",
        "Organization role for the invited people: one for the batch, or one per email",
      )
      .option(
        "--team <team...>",
        "Team the invited people land on, as teamId:role (repeatable)",
      )
      .option("--json <json>", "JSON array of invites (inline)")
      .option("--file <path>", "Read the JSON array of invites from a file")
      .option("--stdin", "Read the JSON array of invites from standard input")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (options: {
      email?: string[];
      role?: string[];
      team?: string[];
      json?: string;
      file?: string;
      stdin?: boolean;
    }) => {
      const { stdin, ...rest } = options;
      const { createInvitesCommand: impl } = await import("./commands/invites/create.js");
      return impl({
        ...rest,
        ...(stdin !== undefined ? { readFromStdin: stdin } : {}),
      });
    },
  );

  emitsResult(
    invitesCmd
      .command("revoke <id>")
      .description("Revoke a pending invite")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (id: string) => {
      const { revokeInviteCommand: impl } = await import("./commands/invites/revoke.js");
      return impl(id);
    },
  );

  const teamsCmd = program
    .command("teams")
    .description("Manage the teams that group projects and people");

  emitsResult(
    teamsCmd
      .command("list")
      .description("List the organization's teams")
      .option("--page <n>", "Page number (default 1)")
      .option("--limit <n>", "Teams per page (default 50)")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (options: { page?: string; limit?: string }) => {
      const { listTeamsCommand: impl } = await import("./commands/teams/list.js");
      return impl(options);
    },
  );

  emitsResult(
    teamsCmd
      .command("get <id>")
      .description("Get a team by its id")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (id: string) => {
      const { getTeamCommand: impl } = await import("./commands/teams/get.js");
      return impl(id);
    },
  );

  emitsResult(
    teamsCmd
      .command("create")
      .description("Create a team")
      .requiredOption("--name <name>", "Team name")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (options: { name: string }) => {
      const { createTeamCommand: impl } = await import("./commands/teams/create.js");
      return impl(options);
    },
  );

  emitsResult(
    teamsCmd
      .command("update <id>")
      .description("Rename a team")
      .requiredOption("--name <name>", "New team name")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (id: string, options: { name: string }) => {
      const { updateTeamCommand: impl } = await import("./commands/teams/update.js");
      return impl({ id, name: options.name });
    },
  );

  emitsResult(
    teamsCmd
      .command("archive <id>")
      .description("Archive a team (soft-delete)")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (id: string) => {
      const { archiveTeamCommand: impl } = await import("./commands/teams/archive.js");
      return impl(id);
    },
  );

  const teamMembersCmd = teamsCmd
    .command("members")
    .description("Manage who belongs to a team");

  emitsResult(
    teamMembersCmd
      .command("list <teamId>")
      .description("List the members of a team")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (teamId: string) => {
      const { listTeamMembersCommand: impl } = await import("./commands/teams/members.js");
      return impl(teamId);
    },
  );

  emitsResult(
    teamMembersCmd
      .command("add <teamId> <userId>")
      .description("Add a member to a team")
      .option("--role <role>", "Role the member gets on the team: ADMIN, MEMBER or VIEWER")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (teamId: string, userId: string, options: { role?: string }) => {
      const { addTeamMemberCommand: impl } = await import("./commands/teams/members.js");
      return impl({ teamId, userId, options });
    },
  );

  emitsResult(
    teamMembersCmd
      .command("remove <teamId> <userId>")
      .description("Remove a member from a team")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (teamId: string, userId: string) => {
      const { removeTeamMemberCommand: impl } = await import("./commands/teams/members.js");
      return impl({ teamId, userId });
    },
  );

  const groupsCmd = program
    .command("groups")
    .description("Manage access groups and what they grant");

  emitsResult(
    groupsCmd
      .command("list")
      .description("List the organization's access groups")
      .option("--page <n>", "Page number (default 1)")
      .option("--limit <n>", "Groups per page (default 50)")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (options: { page?: string; limit?: string }) => {
      const { listGroupsCommand: impl } = await import("./commands/groups/list.js");
      return impl(options);
    },
  );

  emitsResult(
    groupsCmd
      .command("get <id>")
      .description("Get a group with its members and bindings")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (id: string) => {
      const { getGroupCommand: impl } = await import("./commands/groups/get.js");
      return impl(id);
    },
  );

  emitsResult(
    groupsCmd
      .command("create")
      .description("Create an access group")
      .requiredOption("--name <name>", "Group name")
      .option(
        "--binding <binding...>",
        "What the group grants, as role:scopeType:scopeId (repeatable)",
      )
      .option("--member-id <userId...>", "Members to put in the group (repeatable)")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (options: { name: string; binding?: string[]; memberId?: string[] }) => {
      const { createGroupCommand: impl } = await import("./commands/groups/create.js");
      return impl(options);
    },
  );

  emitsResult(
    groupsCmd
      .command("rename <id>")
      .description("Rename a group")
      .requiredOption("--name <name>", "New group name")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (id: string, options: { name: string }) => {
      const { renameGroupCommand: impl } = await import("./commands/groups/rename.js");
      return impl({ id, name: options.name });
    },
  );

  emitsResult(
    groupsCmd
      .command("delete <id>")
      .description("Delete a group and the access it granted")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (id: string) => {
      const { deleteGroupCommand: impl } = await import("./commands/groups/delete.js");
      return impl(id);
    },
  );

  const groupMembersCmd = groupsCmd
    .command("members")
    .description("Manage who belongs to a group");

  emitsResult(
    groupMembersCmd
      .command("list <groupId>")
      .description("List the members of a group")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (groupId: string) => {
      const { listGroupMembersCommand: impl } = await import("./commands/groups/members.js");
      return impl(groupId);
    },
  );

  emitsResult(
    groupMembersCmd
      .command("add <groupId> <userId>")
      .description("Add a member to a group")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (groupId: string, userId: string) => {
      const { addGroupMemberCommand: impl } = await import("./commands/groups/members.js");
      return impl({ groupId, userId });
    },
  );

  emitsResult(
    groupMembersCmd
      .command("remove <groupId> <userId>")
      .description("Remove a member from a group")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (groupId: string, userId: string) => {
      const { removeGroupMemberCommand: impl } = await import("./commands/groups/members.js");
      return impl({ groupId, userId });
    },
  );

  const groupBindingsCmd = groupsCmd
    .command("bindings")
    .description("Manage what a group grants, and where");

  emitsResult(
    groupBindingsCmd
      .command("list <groupId>")
      .description("List a group's role bindings")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (groupId: string) => {
      const { listGroupBindingsCommand: impl } = await import("./commands/groups/bindings.js");
      return impl(groupId);
    },
  );

  emitsResult(
    groupBindingsCmd
      .command("add <groupId>")
      .description("Grant the group a role at a scope")
      .requiredOption("--role <role>", "Role to grant: ADMIN, MEMBER, VIEWER or CUSTOM")
      .option("--custom-role-id <id>", "Custom role to grant, required when the role is CUSTOM")
      .requiredOption("--scope-type <type>", "Where it applies: ORGANIZATION, TEAM or PROJECT")
      .requiredOption("--scope-id <id>", "The organization, team or project id")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (
      groupId: string,
      options: {
        role: string;
        customRoleId?: string;
        scopeType: string;
        scopeId: string;
      },
    ) => {
      const { addGroupBindingCommand: impl } = await import("./commands/groups/bindings.js");
      return impl({ groupId, options });
    },
  );

  emitsResult(
    groupBindingsCmd
      .command("remove <groupId> <bindingId>")
      .description("Remove a role binding from a group")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (groupId: string, bindingId: string) => {
      const { removeGroupBindingCommand: impl } = await import("./commands/groups/bindings.js");
      return impl({ groupId, bindingId });
    },
  );

  const rolesCmd = program
    .command("roles")
    .description("Manage custom roles and the permissions they carry");

  emitsResult(
    rolesCmd
      .command("list")
      .description("List the organization's custom roles")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async () => {
      const { listRolesCommand: impl } = await import("./commands/roles/list.js");
      return impl();
    },
  );

  emitsResult(
    rolesCmd
      .command("get <id>")
      .description("Get a custom role and its permission set")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (id: string) => {
      const { getRoleCommand: impl } = await import("./commands/roles/get.js");
      return impl(id);
    },
  );

  emitsResult(
    rolesCmd
      .command("create")
      .description("Create a custom role from permission keys")
      .requiredOption("--name <name>", "Role name, unique within the organization")
      .option("--description <desc>", "What the role is for")
      .option(
        "--permission <permission...>",
        "A permission as resource:action (repeatable), for example project:view",
      )
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (options: { name: string; description?: string; permission?: string[] }) => {
      const { createRoleCommand: impl } = await import("./commands/roles/create.js");
      return impl(options);
    },
  );

  emitsResult(
    rolesCmd
      .command("update <id>")
      .description("Update a custom role; a permission list replaces the whole set")
      .option("--name <name>", "New role name")
      .option("--description <desc>", "New description")
      .option(
        "--permission <permission...>",
        "The role's complete permission set as resource:action (repeatable)",
      )
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (
      id: string,
      options: { name?: string; description?: string; permission?: string[] },
    ) => {
      const { updateRoleCommand: impl } = await import("./commands/roles/update.js");
      return impl({ id, options });
    },
  );

  emitsResult(
    rolesCmd
      .command("delete <id>")
      .description("Delete a custom role nothing holds any more")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (id: string) => {
      const { deleteRoleCommand: impl } = await import("./commands/roles/delete.js");
      return impl(id);
    },
  );

  emitsResult(
    rolesCmd
      .command("permissions")
      .description("List the permission catalog custom roles are built from")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async () => {
      const { rolePermissionsCommand: impl } = await import("./commands/roles/permissions.js");
      return impl();
    },
  );

  const roleBindingsCmd = program
    .command("role-bindings")
    .description("Grant roles to people, groups and API keys at a scope");

  emitsResult(
    roleBindingsCmd
      .command("list")
      .description("List role bindings, optionally filtered by principal and scope")
      .option("--principal-type <type>", "Kind of principal to filter by: user, group or api-key")
      .option("--principal-id <id>", "The user, group or API key id")
      .option("--scope-type <type>", "Filter by scope: ORGANIZATION, TEAM or PROJECT")
      .option("--scope-id <id>", "Filter by the organization, team or project id")
      .option("--offset <n>", "Skip this many bindings")
      .option("--limit <n>", "Bindings per page (default 50, max 200)")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (options: {
      principalType?: string;
      principalId?: string;
      scopeType?: string;
      scopeId?: string;
      offset?: string;
      limit?: string;
    }) => {
      const { listRoleBindingsCommand: impl } = await import("./commands/role-bindings/list.js");
      return impl(options);
    },
  );

  emitsResult(
    roleBindingsCmd
      .command("create")
      .description("Grant one role to one principal at one scope")
      .requiredOption("--principal-type <type>", "Kind of principal: user, group or api-key")
      .requiredOption("--principal-id <id>", "The user, group or API key id")
      .requiredOption("--role <role>", "Role to grant: ADMIN, MEMBER, VIEWER or CUSTOM")
      .option("--custom-role-id <id>", "Custom role to grant, required when the role is CUSTOM")
      .requiredOption("--scope-type <type>", "Where it applies: ORGANIZATION, TEAM or PROJECT")
      .requiredOption("--scope-id <id>", "The organization, team or project id")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (options: {
      principalType: string;
      principalId: string;
      role: string;
      customRoleId?: string;
      scopeType: string;
      scopeId: string;
    }) => {
      const { createRoleBindingCommand: impl } = await import("./commands/role-bindings/create.js");
      return impl(options);
    },
  );

  emitsResult(
    roleBindingsCmd
      .command("update <id>")
      .description("Change the role a binding grants; principal and scope stay as they are")
      .requiredOption("--role <role>", "Role to grant: ADMIN, MEMBER, VIEWER or CUSTOM")
      .option("--custom-role-id <id>", "Custom role to grant, required when the role is CUSTOM")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (id: string, options: { role: string; customRoleId?: string }) => {
      const { updateRoleBindingCommand: impl } = await import("./commands/role-bindings/update.js");
      return impl({ id, options });
    },
  );

  emitsResult(
    roleBindingsCmd
      .command("delete <id>")
      .description("Delete a role binding")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (id: string) => {
      const { deleteRoleBindingCommand: impl } = await import("./commands/role-bindings/delete.js");
      return impl(id);
    },
  );

  const scimTokensCmd = program
    .command("scim-tokens")
    .description("Mint and revoke the bearer tokens an identity provider uses");

  emitsResult(
    scimTokensCmd
      .command("list")
      .description("List SCIM tokens (values are never returned)")
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async () => {
      const { listScimTokensCommand: impl } = await import("./commands/scim-tokens/list.js");
      return impl();
    },
  );

  emitsResult(
    scimTokensCmd
      .command("create")
      .description("Create a SCIM token (the value is shown once)")
      .option("--description <desc>", "What this token is for, for example the provider's name")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (options: { description?: string }) => {
      const { createScimTokenCommand: impl } = await import("./commands/scim-tokens/create.js");
      return impl(options);
    },
  );

  emitsResult(
    scimTokensCmd
      .command("revoke <id>")
      .description("Revoke a SCIM token so it stops verifying")
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (id: string) => {
      const { revokeScimTokenCommand: impl } = await import("./commands/scim-tokens/revoke.js");
      return impl(id);
    },
  );

  // Self-hosted only, and the one family that authenticates against the
  // INSTANCE rather than an organization: it exists before any organization
  // does. On LangWatch Cloud these paths answer "not found".
  const organizationsCmd = program
    .command("organizations")
    .description(
      "Provision organizations on a self-hosted instance (instance administrator credential)",
    );

  emitsResult(
    organizationsCmd
      .command("create")
      .description("Create an organization and its bootstrap admin API key")
      .requiredOption("--name <name>", "Organization name")
      .option("--slug <slug>", "Organization slug; derived from the name when omitted")
      .option("--admin-api-key-name <name>", "Name for the bootstrap admin API key")
      .option(
        "--instance-key <key>",
        "Instance administrator credential; defaults to LANGWATCH_INSTANCE_ADMIN_API_KEY",
      )
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (options: {
      name: string;
      slug?: string;
      adminApiKeyName?: string;
      instanceKey?: string;
    }) => {
      const { createOrganizationCommand: impl } = await import(
        "./commands/organizations/create.js"
      );
      return impl(options);
    },
  );

  emitsResult(
    organizationsCmd
      .command("list")
      .description("List the organizations on this instance")
      .option(
        "--instance-key <key>",
        "Instance administrator credential; defaults to LANGWATCH_INSTANCE_ADMIN_API_KEY",
      )
      .option("-f, --format <format>", "Output format: table (default) or json", "table"),
    async (options: { instanceKey?: string }) => {
      const { listOrganizationsCommand: impl } = await import(
        "./commands/organizations/list.js"
      );
      return impl(options);
    },
  );

  emitsResult(
    organizationsCmd
      .command("get <id>")
      .description("Get one organization on this instance")
      .option(
        "--instance-key <key>",
        "Instance administrator credential; defaults to LANGWATCH_INSTANCE_ADMIN_API_KEY",
      )
      .option("-f, --format <format>", "Output format: text (default) or json", "text"),
    async (id: string, options: { instanceKey?: string }) => {
      const { getOrganizationByIdCommand: impl } = await import(
        "./commands/organizations/get.js"
      );
      return impl({ id, options });
    },
  );

  // `langwatch daemon *` — the warm background process that serves commands
  // over a private Unix socket. Normally invisible: it is auto-spawned on first
  // use and self-exits when idle. These commands are for inspecting it, or for
  // opting a long-lived session into one explicitly.
  const daemonCmd = program
    .command("daemon")
    .description(
      "Manage the background daemon that serves CLI commands from a warm process (auto-spawned; set LANGWATCH_NO_DAEMON=1 to disable).",
    );

  daemonCmd
    .command("start")
    .description("Start the daemon (backgrounded unless --foreground)")
    .option("--foreground", "Run the daemon in this process instead of backgrounding it")
    .option("--idle-timeout <ms>", "Exit after this many ms with no requests (default 600000)")
    .action(async (options: { foreground?: boolean; idleTimeout?: string }) => {
      const { daemonStartCommand: impl } = await import("./commands/daemon.js");
      await impl(options);
    });

  daemonCmd
    .command("stop")
    .description("Stop the running daemon and remove its socket")
    .action(async () => {
      const { daemonStopCommand: impl } = await import("./commands/daemon.js");
      await impl();
    });

  daemonCmd
    .command("status")
    .description("Show the running daemon's pid, uptime, and request counts")
    .option("--json", "emit machine-readable JSON")
    .action(async (options: { json?: boolean }) => {
      const { daemonStatusCommand: impl } = await import("./commands/daemon.js");
      await impl(options);
    });

  // The output contract's global flags (`-o/--output`, `--json <fields>`,
  // `--jq`, `--agent`), added here — once, centrally — rather than per
  // command. Registered on the built tree so buildProgram() stays a pure
  // factory: no module-level state, nothing leaks between daemon requests.
  registerOutputOptions(program);

  return program;
}
