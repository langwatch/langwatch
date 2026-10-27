/**
 * What to ask, read in command-line order: `--ask` opens a question and
 * `--criteria`/`--score`/`--category`/`--threshold` modify the one before; modifiers before any
 * `--ask` modify the positional question.
 * @see specs/features/instant-eval-cli.feature
 * @see cli/program.ts trackQuestionFlags
 */

import { commandValidationError, reportCommandError } from "../../utils/errorOutput";

/** One question, as the command line described it. */
export interface QuestionDraft {
  instructions?: string;
  criteria: string[];
  /** `--score <min..max>`, unparsed. */
  score?: string;
  /** `--category name=description`, repeatable. */
  categories: string[];
  /** `--threshold <0..1>`, unparsed. */
  threshold?: string;
  /** `--id <name>`, the column this question lands in. */
  id?: string;
}

/** What a run's questions are, in the vocabulary the API takes. */
export interface InstantEvalQuestionInput {
  id?: string;
  kind: "boolean" | "score" | "category";
  instructions: string;
  criteria?: string[];
  threshold?: number;
  range?: { min: number; max: number };
  options?: { name: string; description: string }[];
}

function refuse(message: string): never {
  reportCommandError({ error: commandValidationError(message) });
  process.exit(1);
}

/**
 * The questions the command line asked, or the refusal that says what is missing. `instructions` is
 * the positional argument, which fills the question a modifier opened without an `--ask` of its
 * own.
 */
export function readQuestionFlags({
  drafts,
  instructions,
}: {
  drafts: readonly QuestionDraft[];
  instructions?: string;
}): InstantEvalQuestionInput[] {
  const written = [...drafts];
  if (instructions !== undefined) {
    const implicit = written[0];
    if (implicit && implicit.instructions === undefined) {
      written[0] = { ...implicit, instructions };
    } else if (written.some((draft) => draft.instructions !== undefined)) {
      refuse(
        'Ask the question as the argument or with --ask, not both: langwatch instant-eval run "the customer sounds annoyed", or langwatch instant-eval run --ask "...".',
      );
    } else {
      written.unshift({ instructions, criteria: [], categories: [] });
    }
  }

  if (written.length === 0) return [];

  return written.map((draft) => questionFrom(draft));
}

function questionFrom(draft: QuestionDraft): InstantEvalQuestionInput {
  if (draft.instructions === undefined) {
    refuse(
      "A question needs words: write it as the argument, or with --ask, before the flags that describe it.",
    );
  }
  const base = {
    instructions: draft.instructions,
    ...(draft.id === undefined ? {} : { id: draft.id }),
  };

  if (draft.score !== undefined) {
    if (draft.categories.length > 0) {
      refuse("A question is a rating or a choice, not both: drop --score or --category.");
    }
    return { ...base, kind: "score", range: readRange(draft.score) };
  }
  if (draft.categories.length > 0) {
    return {
      ...base,
      kind: "category",
      options: draft.categories.map(readCategory),
    };
  }
  return {
    ...base,
    kind: "boolean",
    ...(draft.criteria.length > 0 ? { criteria: draft.criteria } : {}),
    ...(draft.threshold === undefined ? {} : { threshold: readThreshold(draft.threshold) }),
  };
}

/** `--score 1..5`. */
function readRange(raw: string): { min: number; max: number } {
  const halves = raw.split("..");
  if (halves.length !== 2) {
    refuse(`Invalid --score value: ${raw} (a scale is written min..max, for example 1..5)`);
  }
  const [min, max] = halves.map((half) => Number(half.trim()));
  if (!Number.isInteger(min) || !Number.isInteger(max)) {
    refuse(`Invalid --score value: ${raw} (both ends of a scale are whole numbers)`);
  }
  return { min: min!, max: max! };
}

/** `--category refund=wants money back`. */
function readCategory(raw: string): { name: string; description: string } {
  const separator = raw.indexOf("=");
  if (separator <= 0) {
    refuse(`Invalid --category value: ${raw} (an option is written name=what it means)`);
  }
  const name = raw.slice(0, separator).trim();
  const description = raw.slice(separator + 1).trim();
  if (name === "" || description === "") {
    refuse(`Invalid --category value: ${raw} (an option needs a name and what it means)`);
  }
  return { name, description };
}

function readThreshold(raw: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    refuse(`Invalid --threshold value: ${raw} (a threshold is a probability between 0 and 1)`);
  }
  return value;
}

/**
 * The questions a file holds, read as JSON or as YAML. The file is the way to ask several questions
 * that each carry their own criteria, scale or options, and the way to name them: a command line
 * with ten questions on it is a file that wants writing.
 */
export async function readQuestionsFile(path: string): Promise<InstantEvalQuestionInput[]> {
  const { readFileSync } = await import("fs");
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    refuse(`Could not read the questions file: ${path}`);
  }

  const parsed = await parseQuestions({ raw: raw!, path });
  const list = Array.isArray(parsed) ? parsed : (parsed as { questions?: unknown }).questions;
  if (!Array.isArray(list)) {
    refuse(
      `The questions file must hold a list of questions, or an object with a questions list: ${path}`,
    );
  }
  return list as InstantEvalQuestionInput[];
}

async function parseQuestions({ raw, path }: { raw: string; path: string }): Promise<unknown> {
  const isYaml = /\.ya?ml$/i.test(path);
  try {
    if (isYaml) {
      // Loaded here rather than at the top of the module: js-yaml costs about
      // eight milliseconds to load and only a YAML questions file needs it.
      const yaml = await import("js-yaml");
      return yaml.load(raw);
    }
    return JSON.parse(raw);
  } catch (error) {
    refuse(
      `Could not read ${path} as ${isYaml ? "YAML" : "JSON"}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
