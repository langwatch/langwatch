/**
 * What the terminal shows while a folder is shared.
 *
 * The shape is the transcript a coding agent prints: one line per call, the
 * tool name in bold with its argument in parentheses, and the result under it
 * behind a hook glyph, dim and indented. Command output is summarised rather
 * than echoed, because the output belongs to Langy and repeating all of it
 * buries the two lines that matter, the permission question and the
 * disconnect.
 *
 * The line builders are plain functions so a test reads the words rather than
 * the colours. The writer owns the screen: `line` appends, `draw` puts lines
 * under the transcript that the next draw or erase replaces, which is what
 * the running spinner and the permission selector are drawn with.
 *
 * @see specs/typescript-sdk/cli-langy-share-control.feature
 */

import chalk from "chalk";
import type {
  BashOutput,
  LocalCall,
  LocalEditReplace,
  LocalToolName,
  PermissionDecision,
} from "../../../agent/local-control-protocol";

/**
 * Who owns the rows under the transcript.
 *
 * Only one of the two draws there at a time. A question is the owner for as
 * long as it is on the screen, because the developer is reading it; a running
 * command's spinner is the owner the rest of the time.
 */
export type BottomOwner = "spinner" | "box";

export interface UiWriter {
  line: (text: string) => void;
  /**
   * Draws lines under the transcript that the next `draw`, `erase` or `line`
   * replaces. A writer with no `draw` prints nothing transient at all.
   *
   * A box takes the bottom of the screen from a spinner. A spinner never
   * takes it from a box: it draws nothing while a question is open.
   */
  draw?: (lines: string[], owner?: BottomOwner) => void;
  /** Erases the block, when the caller is the one that drew it. */
  erase?: (owner?: BottomOwner) => void;
  /** True when the developer can answer a question in this terminal. */
  interactive?: boolean;
}

/** Moves the cursor up and clears the rest of the screen. */
const eraseRows = (rows: number): string =>
  `${String.fromCharCode(27)}[${rows}A${String.fromCharCode(27)}[0J`;

/**
 * The terminal, as a writer that can redraw its last block.
 *
 * A block is only drawn on a real terminal: a piped or redirected stream has
 * no cursor to move, so the spinner and the selector are simply absent there.
 *
 * The rows under the transcript have one owner at a time. Both a spinner and
 * a question used to count their rows in the same place, so a command that
 * finished under an open question erased the question and left the developer
 * with a keyboard that answered a box that was no longer on the screen.
 */
export function createConsoleWriter(
  stream: NodeJS.WriteStream = process.stdout,
): UiWriter {
  const interactive = stream.isTTY === true;
  let drawn = 0;
  let owner: BottomOwner | null = null;
  const eraseAll = (): void => {
    if (drawn === 0) {
      owner = null;
      return;
    }
    stream.write(eraseRows(drawn));
    drawn = 0;
    owner = null;
  };
  return {
    line: (text: string) => {
      eraseAll();
      stream.write(`${text}\n`);
    },
    draw: (lines: string[], drawer: BottomOwner = "box") => {
      if (!interactive) return;
      if (drawer === "spinner" && owner === "box") return;
      eraseAll();
      stream.write(lines.map((entry) => `${entry}\n`).join(""));
      drawn = lines.length;
      owner = drawer;
    },
    erase: (drawer: BottomOwner = "box") => {
      if (owner !== null && owner !== drawer) return;
      eraseAll();
    },
    interactive,
  };
}

/** The terminal. Everything the session prints goes through it. */
export const consoleWriter: UiWriter = createConsoleWriter();

/** A duration as the terminal shows it. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes} min ${seconds} s`;
}

/** How long a command has been running, as the spinner line carries it. */
export function elapsedLabel(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
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

/** How much of a path or a command one headline carries. */
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
  return `${words.replace(/[\s.,;:!?-]+$/, "")}…`;
}

/** The width the terminal wraps at when it cannot report its own. */
export const DEFAULT_TERMINAL_WIDTH = 80;

/** How wide the terminal is right now, with a floor a word still fits in. */
export function terminalWidth(
  columns: number | undefined = process.stdout.columns,
): number {
  if (columns === undefined || !Number.isFinite(columns) || columns < 20) {
    return DEFAULT_TERMINAL_WIDTH;
  }
  return Math.floor(columns);
}

/**
 * `text` broken into lines no wider than `width`, on spaces.
 *
 * The terminal wrapped the approve question in the middle of a word ("is
 * requesting cont / rol over"), because the shell wraps on the column and not
 * on the text. A word longer than the width, a path or a url, keeps its own
 * line rather than being cut.
 */
export function wrapWords(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/ +/).filter((entry) => entry !== "")) {
      if (line === "") {
        line = word;
        continue;
      }
      if (line.length + 1 + word.length <= width) {
        line = `${line} ${word}`;
        continue;
      }
      lines.push(line);
      line = word;
    }
    lines.push(line);
  }
  return lines;
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

// ---------------------------------------------------------------------------
// The transcript
// ---------------------------------------------------------------------------

/** The glyph that opens a call or a notice. */
export const CALL_GLYPH = "⏺";

/** The glyph that opens the result of a call. */
export const RESULT_GLYPH = "⎿";

/** The name each local tool reads as. */
export const TOOL_LABELS: Record<LocalToolName, string> = {
  local_read: "Read",
  local_write: "Write",
  local_edit: "Edit",
  local_bash: "Bash",
  local_grep: "Grep",
  local_find: "Find",
  local_ls: "List",
};

/** What one call reads as inside the parentheses. */
export function callArgument(call: LocalCall): string {
  switch (call.tool) {
    case "local_read":
    case "local_write":
    case "local_edit":
      return call.params.path;
    case "local_bash":
      return call.params.command;
    case "local_grep":
      return call.params.path
        ? `${call.params.pattern} in ${call.params.path}`
        : call.params.pattern;
    case "local_find":
      return call.params.pattern;
    case "local_ls":
      return call.params.path ?? ".";
  }
}

/** The headline of one call: the tool and what it points at. */
export function callHeadline(call: LocalCall): string {
  return `${TOOL_LABELS[call.tool]}(${shorten(callArgument(call), MAX_TARGET_LENGTH)})`;
}

/** How many result lines a command shows before the rest is counted. */
export const MAX_RESULT_LINES = 8;

/**
 * The last lines of some output, at most `MAX_RESULT_LINES`, and a count of
 * what was left out. The last lines are the ones that say how it ended.
 */
export function tailLines(text: string): { lines: string[]; hidden: number } {
  const all = text.split("\n");
  while (all.length > 0 && all[all.length - 1] === "") all.pop();
  if (all.length <= MAX_RESULT_LINES) return { lines: all, hidden: 0 };
  return {
    lines: all.slice(all.length - MAX_RESULT_LINES),
    hidden: all.length - MAX_RESULT_LINES,
  };
}

const plural = (count: number, word: string): string =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

/** How many lines an edit puts in and takes out, as a line-level comparison. */
export function editCounts(edits: LocalEditReplace[]): {
  added: number;
  removed: number;
} {
  let added = 0;
  let removed = 0;
  for (const edit of edits) {
    const before = edit.oldText.split("\n");
    const after = edit.newText.split("\n");
    let head = 0;
    while (
      head < before.length &&
      head < after.length &&
      before[head] === after[head]
    ) {
      head += 1;
    }
    let tail = 0;
    while (
      tail < before.length - head &&
      tail < after.length - head &&
      before[before.length - 1 - tail] === after[after.length - 1 - tail]
    ) {
      tail += 1;
    }
    removed += before.length - head - tail;
    added += after.length - head - tail;
  }
  return { added, removed };
}

/** The lines of a text answer that carry content rather than a footer. */
const contentLines = (text: string): string[] =>
  text
    .split("\n")
    .filter((line) => line !== "" && !/^\[.*\]$/.test(line.trim()));

/**
 * What the result of a file tool reads as: a count, never the content. The
 * content is the model's to read, and the terminal is the developer's.
 */
export function fileOutcome({
  call,
  text,
}: {
  call: LocalCall;
  text: string;
}): string {
  switch (call.tool) {
    case "local_read":
      return `Read ${plural(contentLines(text).length, "line")}`;
    case "local_write": {
      const written =
        call.params.content === "" ? 0 : call.params.content.split("\n").length;
      return `Wrote ${plural(written, "line")}`;
    }
    case "local_edit": {
      const { added, removed } = editCounts(call.params.edits);
      if (added === 0 && removed === 0) return "No line changed";
      if (added === 0) return `Removed ${plural(removed, "line")}`;
      if (removed === 0) return `Added ${plural(added, "line")}`;
      return `Added ${plural(added, "line")}, removed ${plural(removed, "line")}`;
    }
    case "local_grep": {
      const found = contentLines(text);
      return found.length === 0 || text.startsWith("No line matches")
        ? "No match"
        : `Found ${plural(found.length, "line")}`;
    }
    case "local_find": {
      const found = contentLines(text);
      return found.length === 0 || text.startsWith("No file matches")
        ? "No file"
        : `Found ${plural(found.length, "file")}`;
    }
    case "local_ls": {
      // The first line is the directory the listing is of.
      const entries = Math.max(0, contentLines(text).length - 1);
      return `${entries} ${entries === 1 ? "entry" : "entries"}`;
    }
    case "local_bash":
      return "";
  }
}

/** True when a command ended with a status the developer should see. */
export function commandFailed(output: BashOutput): boolean {
  return output.pid === undefined && (output.exitCode ?? 0) !== 0;
}

/** The one line a background command produces: where it runs and where it logs. */
export function backgroundOutcome(output: BashOutput): string {
  const log = output.logPath ? `, log ${output.logPath}` : "";
  return `Running in the background as process ${output.pid}${log}`;
}

/** Everything a command wrote, standard output first. */
export const commandText = (output: BashOutput): string =>
  [output.stdout, output.stderr].filter((part) => part !== "").join("\n");

/** The one line a command that finished quietly produces. */
export function silentOutcome(output: BashOutput): string {
  return `Finished in ${formatDuration(output.durationMs)}, no output`;
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

/** Where a permission answer came from. */
export type AnswerSource = "terminal" | "panel";

/** The patterns of a grant, as the settled line names them. */
export function patternPhrase(patterns: string[]): string {
  const quoted = patterns.map((pattern) => `"${pattern}"`);
  if (quoted.length === 0) return "this";
  if (quoted.length === 1) return quoted[0]!;
  return `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]!}`;
}

/**
 * The one line an answer settles into, under the call it answered.
 *
 * The ask already printed the command in full, so the settled line names the
 * grant rather than repeating the command, and says where the answer came
 * from when it did not come from this terminal.
 */
export function settledLine({
  decision,
  patterns = [],
  reason,
  source = "terminal",
}: {
  decision: PermissionDecision;
  patterns?: string[];
  reason?: string;
  source?: AnswerSource;
}): string {
  const where = source === "panel" ? " on the card in LangWatch" : "";
  switch (decision) {
    case "allow_pattern":
      return `Allowed ${patternPhrase(patterns)} for this session${where}`;
    case "allow_once":
      return `Allowed once${where}`;
    case "deny":
      return reason ? `Denied${where}: ${reason}` : `Denied${where}`;
    case "expired":
      return "No answer arrived, so the call was dropped";
  }
}

export interface LangyUi {
  /** The screen this interface writes on, for the selector to draw on too. */
  writer: UiWriter;
  connected: (input: {
    root: string;
    conversationTitle: string;
    conversationUrl: string;
  }) => void;
  noGitRepository: () => void;
  call: (call: LocalCall) => void;
  callResult: (input: { call: LocalCall; text: string }) => void;
  callOutcome: (input: { call: LocalCall; output: BashOutput }) => void;
  callFailed: (input: { call?: LocalCall; message: string }) => void;
  callRefused: (input: { call?: LocalCall; message: string }) => void;
  /** Draws the spinner under a running command; the returned function stops it. */
  startRunning: () => () => void;
  permissionAsked: (input: { summary: string }) => void;
  permissionSettled: (input: { call?: LocalCall; text: string }) => void;
  policyChanged: (input: { skipPermissions: boolean }) => void;
  connectionLost: (input: { message: string }) => void;
  reconnected: () => void;
  disconnected: (input: { reason: string }) => void;
  leaving: () => void;
  backgroundKept: (input: Array<{ pid: number; logPath: string }>) => void;
  note: (text: string) => void;
  /** Holds transcript lines back while a question owns the bottom of the screen. */
  hold: () => void;
  /** Prints everything that arrived while the transcript was held. */
  release: () => void;
}

/** The transcript line that opens a call or carries a notice. */
export const headlineRow = (text: string): string =>
  `${chalk.gray(CALL_GLYPH)} ${text}`;

/** The transcript line that carries a result, under its call. */
export const resultRow = (text: string): string =>
  `  ${chalk.gray(RESULT_GLYPH)}  ${text}`;

/** A result line after the first one, aligned under it. */
const continuationRow = (text: string): string => `     ${text}`;

/** How many columns the glyph of a headline row takes. */
const HEADLINE_INDENT = 2;

/** How many columns a result row and its continuations are indented by. */
const CONTINUATION_INDENT = 5;

/** The terminal side of a shared folder, over one writer. */
export function createUi(
  writer: UiWriter = consoleWriter,
  { width = terminalWidth }: { width?: () => number } = {},
): LangyUi {
  let held = false;
  const queue: string[] = [];
  /** The call the last headline was printed for, so a result finds its own. */
  let lastCallId: string | undefined;

  const emit = (text: string): void => {
    if (held) {
      queue.push(text);
      return;
    }
    writer.line(text);
  };

  const emitResult = (lines: string[]): void => {
    lines.forEach((text, index) => {
      emit(
        (index === 0 ? resultRow(text) : continuationRow(text)).replace(
          /\s+$/,
          "",
        ),
      );
    });
  };

  /**
   * The result of one call, under its own call line.
   *
   * Langy makes several calls at once, and their results arrive in the order
   * the machine finishes them. A result printed under the last call line is
   * then a result under the wrong call, so a result that does not belong to
   * that line prints the line it does belong to again, dim.
   */
  const emitResultFor = (call: LocalCall | undefined, lines: string[]): void => {
    if (call && lastCallId !== undefined && lastCallId !== call.callId) {
      emit(headlineRow(chalk.gray(callHeadline(call))));
      lastCallId = call.callId;
    }
    emitResult(lines);
  };

  /** Text broken on words to the width of a line that starts with `indent`. */
  const fit = (text: string, indent: number): string[] =>
    wrapWords(text, Math.max(20, width() - indent));

  /** A notice: the glyph, then as many rows as the words need. */
  const notice = (
    text: string,
    paint: (line: string) => string = (line) => line,
  ): void => {
    const [first, ...rest] = fit(text, HEADLINE_INDENT);
    emit(headlineRow(paint(first ?? "")));
    for (const line of rest) emit(continuationRow(paint(line)));
  };

  /** A line under a notice, wrapped the same way. */
  const detail = (
    text: string,
    paint: (line: string) => string = (line) => line,
  ): void => {
    for (const line of fit(text, CONTINUATION_INDENT)) {
      emit(continuationRow(paint(line)));
    }
  };

  return {
    writer,
    connected: ({ root, conversationTitle, conversationUrl }) => {
      emit("");
      notice(`Connected ${root} to "${conversationTitle}".`);
      // The link is one word, so it keeps its own row rather than being cut.
      for (const line of fit(
        `Follow along at ${conversationUrl}`,
        CONTINUATION_INDENT,
      )) {
        emit(
          continuationRow(line.replace(conversationUrl, chalk.cyan(conversationUrl))),
        );
      }
      detail(
        writer.interactive === true
          ? "Permission questions are answered here, or on the card in LangWatch."
          : "Permission questions are answered on the card in LangWatch.",
        chalk.gray,
      );
      detail("Press Ctrl-C to stop sharing.", chalk.gray);
      emit("");
    },
    noGitRepository: () =>
      notice(
        "This folder is not a git repository, so Langy cannot open a pull request from here.",
        chalk.yellow,
      ),
    call: (call) => {
      lastCallId = call.callId;
      emit(
        headlineRow(
          `${chalk.bold(TOOL_LABELS[call.tool])}(${chalk.gray(shorten(callArgument(call), MAX_TARGET_LENGTH))})`,
        ),
      );
    },
    callResult: ({ call, text }) =>
      emitResultFor(call, [chalk.gray(fileOutcome({ call, text }))]),
    callOutcome: ({ call, output }) => {
      if (output.pid !== undefined) {
        emitResultFor(call, [chalk.gray(backgroundOutcome(output))]);
        return;
      }
      const { lines, hidden } = tailLines(commandText(output));
      const printed = [
        ...lines.map((line) => chalk.gray(shorten(line, MAX_TARGET_LENGTH * 2))),
        ...(hidden > 0 ? [chalk.gray(`… +${plural(hidden, "line")}`)] : []),
      ];
      // A command that failed says so first, whatever it printed. One that
      // worked is its own output, and one that printed nothing says how long
      // it took, so a line is never empty.
      if (commandFailed(output)) {
        emitResultFor(call, [
          chalk.red(`Exit code ${output.exitCode}`),
          ...printed,
        ]);
        return;
      }
      emitResultFor(
        call,
        printed.length === 0 ? [chalk.gray(silentOutcome(output))] : printed,
      );
    },
    callFailed: ({ call, message }) =>
      emitResultFor(call, [chalk.red(`Failed: ${shortReason(message)}`)]),
    callRefused: ({ call, message }) =>
      emitResultFor(call, [chalk.yellow(`Refused: ${shortReason(message)}`)]),
    startRunning: () => {
      if (!writer.draw) return () => undefined;
      const startedAt = Date.now();
      // The spinner never takes the screen from an open question, and it
      // erases only what it drew itself.
      const paint = (): void =>
        writer.draw?.(
          [
            resultRow(
              chalk.gray(`Running… ${elapsedLabel(Date.now() - startedAt)}`),
            ),
          ],
          "spinner",
        );
      paint();
      const timer = setInterval(paint, 1000);
      timer.unref?.();
      return () => {
        clearInterval(timer);
        writer.erase?.("spinner");
      };
    },
    permissionAsked: ({ summary }) => {
      // With no selector on this screen the command is the only thing the
      // developer reads before the card is answered, so it prints in full,
      // wrapped where the words end.
      detail(`Langy asked to run ${summary}`, chalk.yellow);
      detail("Answer on the card in LangWatch.", chalk.gray);
    },
    permissionSettled: ({ call, text }) =>
      emitResultFor(call, [chalk.gray(text)]),
    policyChanged: ({ skipPermissions }) =>
      skipPermissions
        ? notice(
            "Permission checks are off for this session. Langy runs commands here without asking.",
            chalk.red,
          )
        : notice("Permission checks are on again for this session.", chalk.green),
    connectionLost: ({ message }) =>
      notice(
        `Lost the connection to LangWatch (${message}). Reconnecting.`,
        chalk.yellow,
      ),
    reconnected: () => notice("Reconnected to LangWatch.", chalk.green),
    disconnected: ({ reason }) => {
      emit("");
      notice(`LangWatch disconnected the folder: ${reason}`);
    },
    leaving: () => {
      emit("");
      notice("Leaving. Telling LangWatch the folder is gone.");
    },
    backgroundKept: (processes) => {
      if (processes.length === 0) return;
      emit("");
      notice("These processes Langy started keep running:");
      for (const entry of processes) {
        emit(continuationRow(`process ${entry.pid}, log ${entry.logPath}`));
      }
      detail(
        `Stop one with: kill ${processes.map((entry) => entry.pid).join(" ")}`,
        chalk.gray,
      );
    },
    note: (text) => notice(text, chalk.gray),
    hold: () => {
      held = true;
    },
    release: () => {
      held = false;
      while (queue.length > 0) writer.line(queue.shift()!);
    },
  };
}
