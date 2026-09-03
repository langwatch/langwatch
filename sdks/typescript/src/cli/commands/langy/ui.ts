/**
 * What the terminal shows while a folder is shared.
 *
 * One line per call, and nothing else: the command output and the failure text
 * belong to Langy, and echoing them here would bury the two lines that matter,
 * the permission question and the disconnect. So a call reads as the tool plus
 * the path or the command, and a failure adds a short reason. The line
 * builders are plain functions so a test reads the words rather than the
 * colours.
 */

import chalk from "chalk";
import type {
  BashOutput,
  LocalCall,
  PermissionDecision,
} from "../../../agent/local-control-protocol";

export interface UiWriter {
  line: (text: string) => void;
}

/** The terminal. Everything the session prints goes through it. */
export const consoleWriter: UiWriter = {
  line: (text: string) => console.log(text),
};

const UNITS = ["B", "KB", "MB", "GB"] as const;

/** A byte count as the terminal shows it. */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? String(Math.round(value)) : value.toFixed(1);
  return `${rounded} ${UNITS[unit]}`;
}

/** A duration as the terminal shows it. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes} min ${seconds} s`;
}

/**
 * How long ago a control request was asked for, as the picker prints it.
 *
 * The developer runs the command minutes after the card appeared, so the age
 * is what tells one row from another when the same folder is asked for twice.
 */
export function askedAgo(createdAt: string, now: number = Date.now()): string {
  const at = Date.parse(createdAt);
  if (Number.isNaN(at)) return "asked just now";
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return "asked just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `asked ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "asked 1 hour ago" : `asked ${hours} hours ago`;
}

/**
 * The conversation link the terminal prints.
 *
 * The platform sends an absolute url. An older platform sends a path, which a
 * terminal cannot open, so the endpoint the CLI already talks to supplies the
 * origin.
 */
export function conversationLink({
  url,
  endpoint,
}: {
  url: string;
  endpoint: string | undefined;
}): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (!endpoint) return url;
  try {
    return new URL(url, endpoint).toString();
  } catch {
    return url;
  }
}

/** How much of a path or a command one line carries. */
const MAX_TARGET_LENGTH = 60;

/** How much of a failure one line carries. */
const MAX_REASON_LENGTH = 70;

/**
 * `text` cut to `max`, at the last whole word when there is one, and closed
 * with an ellipsis. A terminal line that wraps twice is not one line.
 */
export function shorten(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  const words = lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut;
  return `${words.replace(/[\s.,;:!?-]+$/, "")}\u2026`;
}

/**
 * The reason a failure reads as. The full text still goes back to Langy, which
 * is what acts on it; the terminal only says what stopped.
 */
export function shortReason(message: string): string {
  const first = message
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return shorten(first ?? "failed", MAX_REASON_LENGTH);
}

/** What one call reads as: the tool and what it points at. */
export function callLine(call: LocalCall): string {
  switch (call.tool) {
    case "local_read":
      return `read ${shorten(call.params.path, MAX_TARGET_LENGTH)}`;
    case "local_write":
      return `write ${shorten(call.params.path, MAX_TARGET_LENGTH)}`;
    case "local_edit":
      return `edit ${shorten(call.params.path, MAX_TARGET_LENGTH)}`;
    case "local_bash":
      return `bash ${shorten(call.params.command, MAX_TARGET_LENGTH)}`;
    case "local_grep":
      return `grep ${shorten(call.params.pattern, MAX_TARGET_LENGTH)}${call.params.path ? ` in ${shorten(call.params.path, MAX_TARGET_LENGTH)}` : ""}`;
    case "local_find":
      return `find ${shorten(call.params.pattern, MAX_TARGET_LENGTH)}`;
    case "local_ls":
      return `ls ${shorten(call.params.path ?? ".", MAX_TARGET_LENGTH)}`;
  }
}

/** True when a command ended with a status the developer should see. */
export function commandFailed(output: BashOutput): boolean {
  return output.pid === undefined && (output.exitCode ?? 0) !== 0;
}

/** The size and timing of a command, with no output echoed. */
export function commandOutcome(output: BashOutput): string {
  if (output.pid !== undefined) {
    return `started in the background, pid ${output.pid}, log ${output.logPath ?? ""}`;
  }
  const bytes = output.stdout.length + output.stderr.length;
  return `exit ${output.exitCode ?? "none"}, ${formatBytes(bytes)}, ${formatDuration(output.durationMs)}`;
}

/** The words a permission answer produces. */
export function decisionWords(decision: PermissionDecision): string {
  switch (decision) {
    case "allow_once":
      return "allowed once";
    case "allow_pattern":
      return "allowed for this session";
    case "deny":
      return "denied";
    case "expired":
      return "no answer arrived, so the call was dropped";
  }
}

export interface LangyUi {
  connected: (input: {
    root: string;
    conversationTitle: string;
    conversationUrl: string;
  }) => void;
  noGitRepository: () => void;
  call: (call: LocalCall) => void;
  callOutcome: (input: { call: LocalCall; output: BashOutput }) => void;
  callFailed: (input: { call: LocalCall; message: string }) => void;
  permissionAsked: (input: { summary: string; conversationUrl: string }) => void;
  permissionAnswered: (input: {
    summary: string;
    decision: PermissionDecision;
  }) => void;
  policyChanged: (input: { skipPermissions: boolean }) => void;
  connectionLost: (input: { message: string }) => void;
  reconnected: () => void;
  disconnected: (input: { reason: string }) => void;
  leaving: () => void;
  backgroundKept: (input: Array<{ pid: number; logPath: string }>) => void;
  note: (text: string) => void;
}

const bullet = chalk.gray("  •");

/** The terminal side of a shared folder, over one writer. */
export function createUi(writer: UiWriter = consoleWriter): LangyUi {
  return {
    connected: ({ root, conversationTitle, conversationUrl }) => {
      writer.line("");
      writer.line(
        `${chalk.green("Connected")} ${root} to "${conversationTitle}".`,
      );
      writer.line(`  Follow along at ${chalk.cyan(conversationUrl)}`);
      writer.line(
        chalk.gray("  Permission questions appear in the panel, not here."),
      );
      writer.line(chalk.gray("  Press Ctrl-C to stop sharing."));
      writer.line("");
    },
    noGitRepository: () => {
      writer.line(
        chalk.yellow(
          "  This folder is not a git repository, so Langy cannot open a pull request from here.",
        ),
      );
    },
    call: (call) => writer.line(`${bullet} ${callLine(call)}`),
    callOutcome: ({ call, output }) => {
      if (commandFailed(output)) {
        writer.line(
          `${bullet} ${callLine(call)}${chalk.red(`: exit ${output.exitCode}`)}`,
        );
        return;
      }
      writer.line(
        `${bullet} ${callLine(call)} ${chalk.gray(`(${commandOutcome(output)})`)}`,
      );
    },
    callFailed: ({ call, message }) =>
      writer.line(
        `${bullet} ${callLine(call)} ${chalk.red(`failed: ${shortReason(message)}`)}`,
      ),
    permissionAsked: ({ summary, conversationUrl }) => {
      writer.line(
        chalk.yellow(`  Langy asked to run ${summary}.`) +
          ` Answer in the LangWatch panel: ${chalk.cyan(conversationUrl)}`,
      );
    },
    permissionAnswered: ({ summary, decision }) =>
      writer.line(chalk.gray(`  ${summary}: ${decisionWords(decision)}.`)),
    policyChanged: ({ skipPermissions }) =>
      writer.line(
        skipPermissions
          ? chalk.red(
              "  Permission checks are off for this session. Langy runs commands here without asking.",
            )
          : chalk.green("  Permission checks are on again for this session."),
      ),
    connectionLost: ({ message }) =>
      writer.line(chalk.yellow(`  Lost the connection to LangWatch (${message}). Reconnecting.`)),
    reconnected: () => writer.line(chalk.green("  Reconnected to LangWatch.")),
    disconnected: ({ reason }) =>
      writer.line(`\nLangWatch disconnected the folder: ${reason}`),
    leaving: () => writer.line("\nLeaving. Telling LangWatch the folder is gone."),
    backgroundKept: (processes) => {
      if (processes.length === 0) return;
      writer.line("");
      writer.line("These processes Langy started keep running:");
      for (const entry of processes) {
        writer.line(`  pid ${entry.pid}, log ${entry.logPath}`);
      }
      writer.line(
        chalk.gray(`  Stop one with: kill ${processes.map((p) => p.pid).join(" ")}`),
      );
    },
    note: (text) => writer.line(chalk.gray(`  ${text}`)),
  };
}
