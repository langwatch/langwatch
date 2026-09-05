/**
 * The permission question, answered in the terminal.
 *
 * A call that is not read-only stops on two screens at once: the card in the
 * LangWatch panel and this selector, drawn at the bottom of the transcript.
 * The first answer wins, and the CLI applies it here rather than waiting for
 * the platform to relay it back.
 *
 * The box is drawn by hand with chalk over a small keypress loop rather than
 * with the `prompts` package the request picker uses: `prompts` renders its
 * own list style and gives no way to put a framed command and a reason above
 * the choices, which is the whole point of this screen. No dependency is
 * added for it.
 *
 * @see specs/typescript-sdk/cli-langy-share-control.feature
 * @see dev/docs/adr/129-langy-local-control.md
 */

import * as readline from "node:readline";
import chalk from "chalk";
import type {
  LocalCall,
  TerminalPermissionDecision,
} from "../../../agent/local-control-protocol";
import {
  patternPhrase,
  shorten,
  terminalWidth,
  wrapWords,
  type UiWriter,
} from "./ui";

/** One row of the selector. */
export interface ApprovalOption {
  value: TerminalPermissionDecision;
  label: string;
}

/** Everything the box shows for one ask. */
export interface ApprovalCard {
  /** The heading in the top border, naming the folder. */
  title: string;
  /** The command or the path the answer is about. */
  subject: string;
  /** Why the call stopped, and the time limit when there is one. */
  description: string;
  options: ApprovalOption[];
  /** The patterns the session grant would cover, named under the options. */
  patterns: string[];
}

/** What the developer answered in the terminal. */
export interface TerminalApproval {
  decision: TerminalPermissionDecision;
  /** The line the developer typed after a denial, when they typed one. */
  reason?: string;
}

/** An open selector: the answer, and a way to close it when the card wins. */
export interface OpenApproval {
  /** The answer, or null when the selector was closed before it was given. */
  answer: Promise<TerminalApproval | null>;
  close: () => void;
}

/** Opens the selector for one ask. */
export type ApprovalPrompt = (card: ApprovalCard) => OpenApproval;

/** What the developer typed, after choosing to deny. */
export const DENY_REASON_QUESTION =
  "Tell Langy what to do instead, or press Enter to skip: ";

/** The keys the selector reads. */
export interface KeyEvent {
  name?: string;
  ctrl?: boolean;
  sequence?: string;
}

/** Where the keys come from, so a test can push its own. */
export interface KeySource {
  /** Starts delivering keys. The returned function stops it. */
  listen: (onKey: (key: KeyEvent) => void) => () => void;
}

/**
 * The three answers, with the session grant first and selected by default.
 * It names every pattern the grant would cover, so a chain says what all of
 * it allows rather than only its first segment.
 */
export function approvalOptions(patterns: string[]): ApprovalOption[] {
  return [
    {
      value: "allow_pattern",
      label:
        patterns.length === 0
          ? "Yes, allow this for the rest of the session"
          : `Yes, allow ${patternPhrase(patterns)} for this session`,
    },
    { value: "allow_once", label: "Yes, this time only" },
    { value: "deny", label: "No, and tell Langy what to do instead" },
  ];
}

/** The sentence that names the time limit of a command. */
export function timeLimitSentence(seconds: number): string {
  if (seconds < 60) {
    return `Stops after ${seconds} seconds if it has not finished.`;
  }
  const minutes = Math.round(seconds / 60);
  return `Stops after ${minutes} minute${minutes === 1 ? "" : "s"} if it has not finished.`;
}

/** What the box heading says, by the kind of call that asked. */
export function approvalTitle({
  call,
  workspaceName,
}: {
  call: LocalCall;
  workspaceName: string;
}): string {
  if (call.tool === "local_bash") {
    return `Langy wants to run in ${workspaceName}`;
  }
  if (call.tool === "local_write" || call.tool === "local_edit") {
    return `Langy wants to change a file in ${workspaceName}`;
  }
  return `Langy wants to read a file in ${workspaceName}`;
}

/** The card one ask produces. */
export function approvalCardFor({
  call,
  workspaceName,
  summary,
  reason,
  patterns,
  timeoutSeconds,
}: {
  call: LocalCall;
  workspaceName: string;
  summary: string;
  reason: string;
  patterns: string[];
  timeoutSeconds?: number;
}): ApprovalCard {
  const limit =
    timeoutSeconds === undefined ? "" : ` ${timeLimitSentence(timeoutSeconds)}`;
  return {
    title: approvalTitle({ call, workspaceName }),
    subject: summary,
    description: `${reason}${limit}`,
    options: approvalOptions(patterns),
    patterns,
  };
}

/**
 * What the session grant covers, in one sentence under the options.
 *
 * The developer answered "allow for this session" without being told what
 * the grant lets through afterwards, and one of those grants covered every
 * python command on the machine. The sentence names the same patterns the
 * option names, so the two read as one answer.
 */
export function grantCoverageSentence(patterns: string[]): string | null {
  const covered = patterns
    .map((pattern) => pattern.replace(/ \*$/, ""))
    .filter((pattern) => pattern !== "");
  if (covered.length === 0) return null;
  return `The session grant covers every command that starts with ${patternPhrase(covered)}.`;
}

// ---------------------------------------------------------------------------
// Drawing the box
// ---------------------------------------------------------------------------

/** The widest the box is drawn, however wide the terminal is. */
export const MAX_BOX_WIDTH = 100;

const HINT =
  "Enter or a number to answer · ↑↓ to choose · Esc to deny · or answer on the card in LangWatch";

/**
 * The box, as the lines it occupies.
 *
 * Every line is exactly as wide as the box, so the writer can count the rows
 * it drew and move the cursor back over exactly those rows when the selection
 * moves or the box is erased.
 */
export function renderApprovalBox({
  card,
  selected,
  width = terminalWidth(),
}: {
  card: ApprovalCard;
  selected: number;
  width?: number;
}): string[] {
  const box = Math.min(width, MAX_BOX_WIDTH);
  const inner = box - 2;
  const textWidth = inner - 4;

  const body: Array<{ text: string; painted?: string }> = [];
  const plain = (text: string, painted?: string): void => {
    body.push(painted === undefined ? { text } : { text, painted });
  };

  plain("");
  for (const line of wrapWords(card.subject, textWidth)) {
    plain(`   ${line}`, `   ${chalk.bold(line)}`);
  }
  for (const line of wrapWords(card.description, textWidth)) {
    plain(`   ${line}`, `   ${chalk.gray(line)}`);
  }
  plain("");
  plain("   Do you want to allow this?");
  card.options.forEach((option, index) => {
    const chosen = index === selected;
    const marker = `${chosen ? " ❯ " : "   "}${index + 1}. `;
    // A label of a chain names every pattern, so it is wrapped like any other
    // line rather than pushed through the frame.
    wrapWords(option.label, textWidth - marker.length + 3).forEach(
      (line, part) => {
        const row = `${part === 0 ? marker : " ".repeat(marker.length)}${line}`;
        plain(row, chosen ? chalk.cyan(row) : row);
      },
    );
  });
  const coverage = grantCoverageSentence(card.patterns);
  if (coverage !== null) {
    plain("");
    for (const line of wrapWords(coverage, textWidth)) {
      plain(`   ${line}`, `   ${chalk.gray(line)}`);
    }
  }
  plain("");
  for (const line of wrapWords(HINT, textWidth)) {
    plain(`   ${line}`, `   ${chalk.gray(line)}`);
  }

  const heading = ` ${shorten(card.title, Math.max(4, inner - 4))} `;
  const dashes = Math.max(0, inner - 1 - heading.length);
  const top = `╭─${heading}${"─".repeat(dashes)}╮`;
  const bottom = `╰${"─".repeat(inner)}╯`;

  return [
    chalk.gray(top),
    ...body.map(
      (entry) =>
        `${chalk.gray("│")}${entry.painted ?? entry.text}${" ".repeat(Math.max(0, inner - entry.text.length))}${chalk.gray("│")}`,
    ),
    chalk.gray(bottom),
  ];
}

// ---------------------------------------------------------------------------
// Reading the answer
// ---------------------------------------------------------------------------

/**
 * Keys from the real terminal, in raw mode for as long as one ask is open.
 *
 * Raw mode stops the terminal from turning Ctrl-C into a signal, so this
 * raises it instead. Without that, Ctrl-C did nothing at all while a question
 * was on the screen and the only way out was to kill the process.
 */
export function createStdinKeySource(
  stdin: NodeJS.ReadStream = process.stdin,
): KeySource {
  return {
    listen: (onKey) => {
      readline.emitKeypressEvents(stdin);
      const wasRaw = stdin.isRaw === true;
      if (stdin.isTTY && !wasRaw) stdin.setRawMode(true);
      const handler = (_: string, key: KeyEvent | undefined): void => {
        if (!key) return;
        if (key.ctrl === true && key.name === "c") {
          if (process.listenerCount("SIGINT") === 0) process.exit(130);
          process.emit("SIGINT");
          return;
        }
        onKey(key);
      };
      stdin.on("keypress", handler);
      stdin.resume();
      return () => {
        stdin.off("keypress", handler);
        if (stdin.isTTY && !wasRaw) stdin.setRawMode(false);
        stdin.pause();
      };
    },
  };
}

/** One line of text from the terminal, with the question in front of it. */
export async function readReasonFromStdin(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return await new Promise<string>((resolve) => {
      rl.question(chalk.gray(question), resolve);
    });
  } finally {
    rl.close();
  }
}

export interface ApprovalPromptConfig {
  writer: UiWriter;
  keys?: KeySource;
  readReason?: (question: string) => Promise<string>;
  width?: () => number;
}

/**
 * The selector, or null when this screen cannot ask: a piped or redirected
 * output has no cursor to draw on, so the card in the panel is the only way
 * to answer.
 */
export function createTerminalApprovals({
  writer,
  keys = createStdinKeySource(),
  readReason = readReasonFromStdin,
  width = terminalWidth,
}: ApprovalPromptConfig): ApprovalPrompt | null {
  if (writer.interactive !== true || !writer.draw) return null;
  return (card) => askApproval({ card, writer, keys, readReason, width });
}

/** Draws one ask and reads the answer. Exported so a test can drive it. */
export function askApproval({
  card,
  writer,
  keys,
  readReason,
  width = terminalWidth,
}: {
  card: ApprovalCard;
  writer: UiWriter;
  keys: KeySource;
  readReason: (question: string) => Promise<string>;
  width?: () => number;
}): OpenApproval {
  let selected = 0;
  let settled = false;
  let stopKeys: () => void = () => undefined;
  let deliver: (value: TerminalApproval | null) => void = () => undefined;
  const answer = new Promise<TerminalApproval | null>((resolve) => {
    deliver = resolve;
  });

  const paint = (): void => {
    writer.draw?.(renderApprovalBox({ card, selected, width: width() }));
  };

  const finish = (value: TerminalApproval | null): void => {
    if (settled) return;
    settled = true;
    stopKeys();
    writer.erase?.();
    deliver(value);
  };

  const confirm = (): void => {
    const option = card.options[selected];
    if (!option || settled) return;
    if (option.value !== "deny") {
      finish({ decision: option.value });
      return;
    }
    // The box goes away before the question, so the developer types on a
    // clean line rather than over the frame.
    settled = true;
    stopKeys();
    writer.erase?.();
    void readReason(DENY_REASON_QUESTION).then((typed) => {
      const reason = typed.trim();
      deliver({ decision: "deny", ...(reason === "" ? {} : { reason }) });
    });
  };

  const move = (step: number): void => {
    selected =
      (selected + step + card.options.length) % card.options.length;
    paint();
  };

  stopKeys = keys.listen((key) => {
    if (settled) return;
    if (key.ctrl === true && key.name === "c") return;
    switch (key.name) {
      case "up":
      case "k":
        move(-1);
        return;
      case "down":
      case "j":
        move(1);
        return;
      case "escape":
        finish({ decision: "deny" });
        return;
      case "return":
      case "enter":
        confirm();
        return;
      default:
        break;
    }
    // A number answers on its own, the way a coding agent's own permission
    // dialog does: the option it names is the option that is taken.
    const digit = Number(key.name ?? key.sequence ?? "");
    if (Number.isInteger(digit) && digit >= 1 && digit <= card.options.length) {
      selected = digit - 1;
      paint();
      confirm();
    }
  });

  paint();
  return { answer, close: () => finish(null) };
}
