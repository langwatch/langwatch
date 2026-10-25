/**
 * What a Studio code block tells Langy: the ask from its editor, and the answer to
 * `studio.code.read`. Secret names only, never a value. Pure.
 * @see specs/langy/langy-studio-code-blocks.feature
 */

import type { LangyAskContext, LangyAskRequest } from "@langwatch/langy-contract";
import {
  STUDIO_CODE_READ_MAX_BYTES,
  type StudioCodeProposal,
  type StudioCodeReadResult,
} from "@langwatch/workflow-contract";

import type { CodeLanguage } from "../code-language.ts";

/** An ask starts a conversation, which is what this permission allows. */
export const LANGY_ASK_PERMISSION = "langy:create";

/** Proposing code is editing the workflow; the editor refuses it to a reader who may not. */
export const CODE_PROPOSE_PERMISSION = "workflows:manage";

/** How much of the buffer rides in the question; the whole buffer is one read away. */
export const MAX_ASK_CODE_LENGTH = 8_000;

/** How much of the node's last error is handed over. */
export const MAX_LAST_ERROR_LENGTH = 1_000;

/** Langy's own bounds on a context reference and its label. */
const MAX_REF_LENGTH = 4_000;
const MAX_LABEL_LENGTH = 200;

/** The code node the editor is open on. */
export type CodeBlockLangySubject = {
  nodeId: string;
  nodeName: string;
  /** The node's last run error, when its last run failed. */
  lastError?: string;
};

type CodeField = { identifier: string; type: string };

/** The code block as the editor holds it right now. */
export type CodeBlockSnapshot = {
  subject: CodeBlockLangySubject;
  language: CodeLanguage;
  /** The unsaved buffer. */
  code: string;
  /** The code as the workflow holds it, before the reader's unsaved edits. */
  savedCode: string;
  inputs: readonly CodeField[];
  outputs: readonly CodeField[];
  secretNames: readonly string[];
};

/** What the editor needs from Langy: the ask, and the proposal waiting for the reader. */
export type CodeEditorAssistant = {
  ask(instruction: string): void;
  proposal: Pick<StudioCodeProposal, "code" | "summary"> | null;
  /** The reader accepted or rejected the proposal; either way it is gone. */
  settle(): void;
  /** The buffer as it changes, so a read sees the reader's unsaved edits. */
  observe(code: string): void;
};

const LANGUAGE_LABEL: Record<CodeLanguage, string> = {
  python: "Python",
  javascript: "JavaScript",
  typescript: "TypeScript",
};

/** The project's secrets as the editor may hand them on: by name, and nothing else. */
export function codeBlockSecretNames(secrets: readonly { name: string }[]): string[] {
  return secrets.map(({ name }) => name);
}

/** Langy is offered only when it is rolled out, the reader may ask it, and it is installed. */
export function isCodeLangyAvailable({
  flag,
  mayAsk,
  installed,
}: {
  flag: boolean | undefined;
  mayAsk: boolean;
  installed: boolean;
}): boolean {
  return flag === true && mayAsk && installed;
}

function lastErrorOf(subject: CodeBlockLangySubject): string | null {
  const error = subject.lastError?.trim();
  return error ? error.slice(0, MAX_LAST_ERROR_LENGTH) : null;
}

function fieldsText(fields: readonly CodeField[]): string {
  return fields.length > 0
    ? fields.map(({ identifier, type }) => `${identifier}: ${type}`).join(", ")
    : "none";
}

/** The code block as `studio.code.read` answers it. */
export function codeBlockReadAnswer(
  snapshot: CodeBlockSnapshot & { readToken: string },
): StudioCodeReadResult {
  const answer = {
    readToken: snapshot.readToken,
    nodeId: snapshot.subject.nodeId,
    nodeName: snapshot.subject.nodeName,
    language: snapshot.language,
    code: snapshot.code,
    codeTooLarge: false,
    inputs: snapshot.inputs.map(({ identifier, type }) => ({ identifier, type })),
    outputs: snapshot.outputs.map(({ identifier, type }) => ({ identifier, type })),
    secretNames: [...snapshot.secretNames],
    lastError: lastErrorOf(snapshot.subject),
    hasUnsavedChanges: snapshot.code !== snapshot.savedCode,
  };
  const size = new TextEncoder().encode(JSON.stringify(answer)).byteLength;
  return size > STUDIO_CODE_READ_MAX_BYTES ? { ...answer, code: "", codeTooLarge: true } : answer;
}

/** The code block as the agent reads it beside the question: data, never instructions. */
function codeBlockContext(snapshot: CodeBlockSnapshot): LangyAskContext {
  const { subject } = snapshot;
  const secrets = snapshot.secretNames.length > 0 ? snapshot.secretNames.join(", ") : "none";
  const lastError = lastErrorOf(subject);
  const ref = [
    `${LANGUAGE_LABEL[snapshot.language]} code block "${subject.nodeName}" (node ${subject.nodeId}), open in the Studio code editor`,
    `inputs: ${fieldsText(snapshot.inputs)}`,
    `outputs: ${fieldsText(snapshot.outputs)}`,
    `secrets, by name only: ${secrets}`,
    `last error: ${lastError ?? "none"}`,
  ].join("; ");
  return {
    kind: "workflow",
    ref: ref.slice(0, MAX_REF_LENGTH),
    label: `Code block: ${subject.nodeName}`.slice(0, MAX_LABEL_LENGTH),
  };
}

/** A fence longer than any run of backticks in the code, so the code cannot close it. */
function fenceFor(code: string): string {
  const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length));
  return "`".repeat(Math.max(3, longest + 1));
}

function bufferExcerpt(code: string): string {
  if (code.length <= MAX_ASK_CODE_LENGTH) return code;
  const rest = code.length - MAX_ASK_CODE_LENGTH;
  return `${code.slice(0, MAX_ASK_CODE_LENGTH)}\n[truncated: ${rest} more characters; studio.code.read answers the whole buffer]`;
}

/** The reader's instruction, asked with the code block attached. */
export function codeBlockAskRequest({
  instruction,
  snapshot,
}: {
  instruction: string;
  snapshot: CodeBlockSnapshot;
}): LangyAskRequest {
  const language = LANGUAGE_LABEL[snapshot.language];
  const excerpt = bufferExcerpt(snapshot.code);
  const fence = fenceFor(excerpt);
  const question = [
    instruction.trim(),
    "",
    `I am editing the ${language} code block "${snapshot.subject.nodeName}" in the Studio code ` +
      "editor. Follow the studio-code-blocks skill: read it with `langwatch ui call " +
      "studio.code.read`, then propose the change with `studio.code.propose` so I can review " +
      "the diff. Do not save or run anything.",
    "",
    "The unsaved buffer:",
    `${fence}${snapshot.language}`,
    excerpt,
    fence,
  ].join("\n");
  return { question, context: [codeBlockContext(snapshot)] };
}
