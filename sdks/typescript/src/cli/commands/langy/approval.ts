/**
 * The permission question, answered in the terminal. A call that is not
 * read-only stops on two screens at once; the first answer wins. Drawn by
 * hand with chalk since `prompts` can't frame a command above the choices.
 */

import * as readline from "node:readline";

import chalk from "chalk";

import type { LocalCall, TerminalPermissionDecision } from "../../../agent/local-control-protocol";
import { patternPhrase, shorten, terminalWidth, wrapWords, type UiWriter } from "./ui";

/** One row of a box. */
export interface BoxOption<T> {
  value: T;
  label: string;
}

/** Everything a box shows for one question. */
export interface BoxCard<T> {
  /** The heading in the top border, naming the folder. */
  title: string;
  /** The command, the path or the conversation the answer is about. */
  subject: string;
  /** Why the question is being asked, and the time limit when there is one. */
  description: string;
  /** The line above the options. */
  question: string;
  options: BoxOption<T>[];
  /** The keys the footer names. */
  hint: string;
  /** The patterns a session grant would cover, named under the options. */
  patterns?: string[];
}

/** One row of the permission selector. */
export type ApprovalOption = BoxOption<TerminalPermissionDecision>;

/** Everything the box shows for one permission ask. */
export type ApprovalCard = BoxCard<TerminalPermissionDecision>;

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

/** The footer of the permission box. */
export const APPROVAL_HINT =
  "Enter or a number to answer · ↑↓ to choose · Esc to deny · or answer on the card in LangWatch";

/** What the developer typed, after choosing to deny. */
export const DENY_REASON_QUESTION = "Tell Langy what to do instead, or press Enter to skip: ";

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
  if (call.tool === "local_langwatch_env") {
    return `Langy wants to write a file in ${workspaceName}`;
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
  const limit = timeoutSeconds === undefined ? "" : ` ${timeLimitSentence(timeoutSeconds)}`;
  return {
    title: approvalTitle({ call, workspaceName }),
    subject: summary,
    description: `${reason}${limit}`,
    question: "Do you want to allow this?",
    options: approvalOptions(patterns),
    hint: APPROVAL_HINT,
    patterns,
  };
}

/**
 * What the session grant covers, in one sentence under the options — so the
 * developer isn't answering "allow for this session" blind to how wide it
 * reaches (a bare pattern once covered every python command on the machine).
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

/**
 * The box, as the lines it occupies. Every line is exactly as wide as the
 * box, so the writer can count the rows it drew and move the cursor back
 * over exactly those rows on redraw or erase.
 */
export function renderBox<T>({
  card,
  selected,
  width = terminalWidth(),
}: {
  card: BoxCard<T>;
  selected: number;
  width?: number;
}): string[] {
  const box = Math.min(width, MAX_BOX_WIDTH);
  const inner = box - 2;
  const textWidth = inner - 4;

  const body: { text: string; painted?: string }[] = [];
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
  plain(`   ${card.question}`);
  card.options.forEach((option, index) => {
    for (const row of optionRows({ label: option.label, index, selected, textWidth })) {
      plain(row.text, row.painted);
    }
  });
  const coverage = grantCoverageSentence(card.patterns ?? []);
  if (coverage !== null) {
    plain("");
    for (const line of wrapWords(coverage, textWidth)) {
      plain(`   ${line}`, `   ${chalk.gray(line)}`);
    }
  }
  plain("");
  for (const line of wrapWords(card.hint, textWidth)) {
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

function optionRows({
  label,
  index,
  selected,
  textWidth,
}: {
  label: string;
  index: number;
  selected: number;
  textWidth: number;
}): { text: string; painted: string }[] {
  const chosen = index === selected;
  const marker = `${chosen ? " ❯ " : "   "}${index + 1}. `;
  // A label of a chain names every pattern, so it is wrapped like any other
  // line rather than pushed through the frame.
  return wrapWords(label, textWidth - marker.length + 3).map((line, part) => {
    const row = `${part === 0 ? marker : " ".repeat(marker.length)}${line}`;
    return { text: row, painted: chosen ? chalk.cyan(row) : row };
  });
}

// ---------------------------------------------------------------------------
// Reading the answer
// ---------------------------------------------------------------------------

/**
 * Keys from the real terminal, in raw mode for as long as one ask is open.
 * Raw mode stops the terminal from turning Ctrl-C into a signal, so this
 * raises it instead.
 */
export function createStdinKeySource(stdin: NodeJS.ReadStream = process.stdin): KeySource {
  return {
    listen: (onKey) => {
      readline.emitKeypressEvents(stdin);
      const wasRaw = stdin.isRaw === true;
      if (stdin.isTTY && !wasRaw) stdin.setRawMode(true);
      const handler = (_: string, key: KeyEvent | undefined): void => {
        if (!key) return;
        if (key.ctrl === true && key.name === "c") {
          raiseInterrupt();
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

function raiseInterrupt(): void {
  if (process.listenerCount("SIGINT") === 0) process.exit(130);
  process.emit("SIGINT");
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

/** An open box: the answer, and a way to close it before it is given. */
export interface OpenBox<T> {
  /** The answer, or null when the box was closed before one was given. */
  answer: Promise<T | null>;
  close: () => void;
}

/**
 * Draws one box and reads the answer; every question the terminal asks goes
 * through this. The box owns the bottom of the screen while open, so a
 * command that finishes under it neither erases nor scrolls it away.
 */
export function askBox<TValue, TAnswer = TValue>({
  card,
  writer,
  keys,
  width = terminalWidth,
  settle,
  escape,
}: {
  card: BoxCard<TValue>;
  writer: UiWriter;
  keys: KeySource;
  width?: () => number;
  /**
   * What a chosen option answers with, read after the box is off the screen
   * so anything it asks for is typed on a clean line. Left out, the value of
   * the option is the answer.
   */
  settle?: (value: TValue) => TAnswer | Promise<TAnswer>;
  /** What Escape answers with. Left out, Escape does nothing. */
  escape?: { answer: TAnswer };
}): OpenBox<TAnswer> {
  let deliver: (value: TAnswer | null) => void = () => undefined;
  const answer = new Promise<TAnswer | null>((resolve) => {
    deliver = resolve;
  });
  const box = new BoxSession<TValue, TAnswer>({ card, writer, width, settle, escape, deliver });
  box.stopKeys = keys.listen((key) => box.onKey(key));

  box.paint();
  return {
    answer,
    close: () => {
      if (box.closeScreen()) deliver(null);
    },
  };
}

/** One open box: which option is selected, and whether it has been answered. */
class BoxSession<TValue, TAnswer> {
  private selected = 0;
  private settled = false;
  stopKeys: () => void = () => undefined;
  private readonly card: BoxCard<TValue>;
  private readonly writer: UiWriter;
  private readonly width: () => number;
  private readonly settle?: (value: TValue) => TAnswer | Promise<TAnswer>;
  private readonly escape?: { answer: TAnswer };
  private readonly deliver: (value: TAnswer | null) => void;

  constructor(args: {
    card: BoxCard<TValue>;
    writer: UiWriter;
    width: () => number;
    settle?: (value: TValue) => TAnswer | Promise<TAnswer>;
    escape?: { answer: TAnswer };
    deliver: (value: TAnswer | null) => void;
  }) {
    this.card = args.card;
    this.writer = args.writer;
    this.width = args.width;
    this.settle = args.settle;
    this.escape = args.escape;
    this.deliver = args.deliver;
  }

  paint(): void {
    this.writer.draw?.(
      renderBox({ card: this.card, selected: this.selected, width: this.width() }),
      "box",
    );
  }

  /** Takes the box off the screen, so what follows is typed on a clean line. */
  closeScreen(): boolean {
    if (this.settled) return false;
    this.settled = true;
    this.stopKeys();
    this.writer.erase?.("box");
    return true;
  }

  onKey(key: KeyEvent): void {
    if (this.settled) return;
    if (key.ctrl === true && key.name === "c") return;
    if (this.onNamedKey(key.name)) return;
    // A number answers on its own, the way a coding agent's own permission
    // dialog does: the option it names is the option that is taken.
    const digit = Number(key.name ?? key.sequence ?? "");
    if (Number.isInteger(digit) && digit >= 1 && digit <= this.card.options.length) {
      this.selected = digit - 1;
      this.paint();
      this.confirm();
    }
  }

  /** Handles a movement, escape or confirm key; false for any other. */
  private onNamedKey(name: KeyEvent["name"]): boolean {
    switch (name) {
      case "up":
      case "k":
        this.move(-1);
        return true;
      case "down":
      case "j":
        this.move(1);
        return true;
      case "escape":
        if (this.escape && this.closeScreen()) this.deliver(this.escape.answer);
        return true;
      case "return":
      case "enter":
        this.confirm();
        return true;
      default:
        return false;
    }
  }

  private confirm(): void {
    const option = this.card.options[this.selected];
    if (!option || !this.closeScreen()) return;
    if (!this.settle) {
      this.deliver(option.value as unknown as TAnswer);
      return;
    }
    void Promise.resolve(this.settle(option.value)).then(this.deliver);
  }

  private move(step: number): void {
    const count = this.card.options.length;
    this.selected = (this.selected + step + count) % count;
    this.paint();
  }
}

/** Draws one permission ask and reads the answer. Exported so a test can drive it. */
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
  return askBox<TerminalPermissionDecision, TerminalApproval>({
    card,
    writer,
    keys,
    width,
    // A denial reads one line of text, and it is typed after the box is off
    // the screen rather than over the frame.
    settle: async (decision) => {
      if (decision !== "deny") return { decision };
      const typed = (await readReason(DENY_REASON_QUESTION)).trim();
      return { decision: "deny", ...(typed === "" ? {} : { reason: typed }) };
    },
    escape: { answer: { decision: "deny" } },
  });
}
