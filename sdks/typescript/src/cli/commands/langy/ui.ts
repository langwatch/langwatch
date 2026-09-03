/**
 * What the terminal shows while a folder is shared.
 *
 * One line per call, and nothing else: the command output belongs to Langy,
 * and echoing it here would bury the two lines that matter, the permission
 * question and the disconnect. The line builders are plain functions so a
 * test reads the words rather than the colours.
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

/** What one call reads as: the tool and what it points at. */
export function callLine(call: LocalCall): string {
  switch (call.tool) {
    case "local_read":
      return `read ${call.params.path}`;
    case "local_write":
      return `write ${call.params.path}`;
    case "local_edit":
      return `edit ${call.params.path}`;
    case "local_bash":
      return `bash ${call.params.command}`;
    case "local_grep":
      return `grep ${call.params.pattern}${call.params.path ? ` in ${call.params.path}` : ""}`;
    case "local_find":
      return `find ${call.params.pattern}`;
    case "local_ls":
      return `ls ${call.params.path ?? "."}`;
  }
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
  callOutcome: (input: { call: LocalCall; outcome: string }) => void;
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
    callOutcome: ({ call, outcome }) =>
      writer.line(`${bullet} ${callLine(call)} ${chalk.gray(`(${outcome})`)}`),
    callFailed: ({ call, message }) =>
      writer.line(`${bullet} ${callLine(call)} ${chalk.red(`(${message})`)}`),
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
