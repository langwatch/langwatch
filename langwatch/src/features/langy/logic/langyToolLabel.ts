import { parseLangwatchCommand } from "~/server/app-layer/langy/execution/langwatchCommand";
import { githubStepOf } from "~/server/app-layer/langy/execution/githubCommand";
import { resolveCapabilityProgress } from "../components/capabilities/capabilityRegistry";
import { findSkill } from "~/shared/langy/langySkills";

/**
 * What a tool call is DOING, in human words.
 *
 * ── THE BUG THIS EXISTS TO KILL ────────────────────────────────────────────
 * The cards used to be labelled from the tool's TYPE. So a call to opencode's
 * `skill` tool rendered a card that said "SKILL / Skill", and a `bash` call
 * running `langwatch trace search` rendered "BASH / Coding…". Both are the same
 * mistake twice: the name of the mechanism where the name of the ACT belongs.
 * Neither told the user anything, and "Coding" was not even true.
 *
 * The intent was never in the tool's name. It was always one field down, in its
 * INPUT — the command, the skill, the path. So that is what we read.
 *
 * ── THE NORMALISATION THAT MAKES THE WHOLE KIT WORK ────────────────────────
 * The server's CLI envelope rewrites `bash("langwatch trace search")` to the
 * typed name `langwatch.trace.search`, but only on the DURABLE event. The tool
 * part the browser streams is still a bare `bash`. That is why capability cards
 * were not rendering either: nothing downstream could see that the shell call
 * WAS a trace search.
 *
 * `effectiveToolName` closes that gap client-side, before anything else looks at
 * the frame. A shell call carrying a LangWatch command becomes the command it
 * is, and then every existing mapping — the capability registry, the pending
 * card, the settled card — lights up on its own. One normalisation, not a
 * special case per surface.
 */

/** Tool names that mean "run a shell command" (mirrors the server's envelope). */
const SHELL_TOOLS = new Set(["bash", "shell", "execute"]);

/** Keys a shell tool may pass its command under. */
const COMMAND_KEYS = ["command", "cmd", "script"] as const;

/** Keys opencode's `skill` tool may name the skill under. */
const SKILL_KEYS = ["name", "skill", "id", "skill_name"] as const;

function readString(
  input: unknown,
  keys: readonly string[],
): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function shellCommandOf(
  name: string,
  input: unknown,
): string | undefined {
  if (!SHELL_TOOLS.has(name.toLowerCase())) return undefined;
  return readString(input, COMMAND_KEYS);
}

/**
 * The name a tool frame should be TREATED as.
 *
 * A shell call running a LangWatch CLI command is not a shell call — it is that
 * capability, and the rest of the kit already knows how to draw it. Everything
 * else keeps its own name.
 */
export function effectiveToolName(name: string, input: unknown): string {
  const command = shellCommandOf(name, input);
  if (!command) return name;
  const parsed = parseLangwatchCommand(command);
  return parsed ? `langwatch.${parsed.resource}.${parsed.verb}` : name;
}

export interface LangyToolLabel {
  /** Present tense, human: "Searching traces", "Using the GitHub skill". */
  title: string;
  /** The concrete thing being acted on — the command, the path, the query. */
  detail?: string;
  /** Consecutive calls sharing a key collapse into one card. */
  key: string;
}

/** `src/agents/router.ts` → `router.ts`. A full path is noise in a chat. */
function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function truncate(value: string, max = 120): string {
  const clean = value.trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Turn shell syntax into the customer-facing act when it is safely obvious. */
function describeShellIntent(command: string): {
  title: string;
  detail?: string;
} | null {
  const lower = command.toLowerCase();
  const readsToolOutput = /(?:^|\/)tool-output(?:\/|$)/.test(lower);
  if (
    readsToolOutput &&
    /(wc\s+-l|grep\s+-(?:c|o)|jq\s+.*length)/.test(lower)
  ) {
    return { title: "Counting results", detail: "Previous tool output" };
  }
  if (readsToolOutput) {
    return { title: "Inspecting results", detail: "Previous tool output" };
  }
  if (/^\s*(?:rg|grep)\b/.test(lower)) {
    return { title: "Searching the output", detail: truncate(command, 80) };
  }
  return null;
}

/** The GitHub PR flow, named by the command that performs it. */
const GITHUB_STAGE_TITLE: Record<string, string> = {
  cloning: "Cloning the repository",
  cloned: "Cloning the repository",
  branched: "Creating a branch",
  committed: "Committing the change",
  pushed: "Pushing the branch",
  opening_pr: "Opening the pull request",
  opened: "Opening the pull request",
};

/** Generic (non-LangWatch, non-GitHub) tools, by what they do. */
const GENERIC_TOOLS: Record<string, { title: string; key: string }> = {
  read: { title: "Reading a file", key: "files" },
  write: { title: "Writing a file", key: "files" },
  edit: { title: "Editing a file", key: "files" },
  multiedit: { title: "Editing files", key: "files" },
  patch: { title: "Applying a patch", key: "files" },
  list: { title: "Looking through files", key: "files" },
  glob: { title: "Looking through files", key: "files" },
  grep: { title: "Searching the code", key: "files" },
  webfetch: { title: "Reading the web", key: "web" },
  fetch: { title: "Reading the web", key: "web" },
  todowrite: { title: "Planning", key: "plan" },
  todoread: { title: "Planning", key: "plan" },
  task: { title: "Working through a sub-task", key: "task" },
};

/** `format_code` → "Format code". The floor, never the first choice. */
function humanize(name: string): string {
  const spaced = name
    .replace(/^langwatch\./, "")
    .replace(/[_.-]+/g, " ")
    .trim();
  if (!spaced) return "Working";
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Describe one tool call. The single mapping every activity card goes through —
 * there is no per-tool branch anywhere else in the UI.
 */
export function describeToolCall({
  name,
  input,
}: {
  name: string;
  input: unknown;
}): LangyToolLabel {
  const lower = name.toLowerCase();

  // ── The skill tool. THE point of the card is which skill, and what it does.
  if (lower === "skill" || lower === "use_skill") {
    const skillId = readString(input, SKILL_KEYS);
    const skill = skillId ? findSkill(skillId) : undefined;
    if (skill) {
      // A recipe is a walkthrough, not a standing capability, and saying "the
      // Generate RAG dataset skill" reads like we don't know our own product.
      const kind = skill.source === "recipe" ? "recipe" : "skill";
      return {
        title: `Using the ${skill.label} ${kind}`,
        // The summary comes from the derived catalogue — the skill's OWN
        // SKILL.md description, which is the copy on the public skill directory.
        // The card therefore cannot over-promise: it can only quote the skill.
        detail: skill.summary,
        key: `skill:${skill.id}`,
      };
    }
    return {
      title: skillId ? `Using the ${skillId} skill` : "Using a skill",
      key: `skill:${skillId ?? "unknown"}`,
    };
  }

  // ── A LangWatch capability (either typed by the envelope, or a shell call we
  //    normalised into one). Worded by the SAME registry that words its card, so
  //    the running line and the settled card cannot disagree.
  const progress = resolveCapabilityProgress(effectiveToolName(name, input));
  if (progress) {
    const command = shellCommandOf(name, input);
    return {
      title: progress.headline,
      detail: command ? truncate(command) : undefined,
      key: `capability:${progress.surface}`,
    };
  }

  // ── A shell call that is NOT a LangWatch command.
  const command = shellCommandOf(name, input);
  if (command) {
    const step = githubStepOf(command);
    if (step) {
      return {
        title: GITHUB_STAGE_TITLE[step.end] ?? "Working with GitHub",
        detail: step.detail ?? truncate(command),
        key: "github",
      };
    }
    const intent = describeShellIntent(command);
    if (intent) return { ...intent, key: "shell" };
    // Honest and specific: we do not know what this command is for, so we show
    // the command. "Coding" was a guess, and it was usually wrong.
    return {
      title: "Running a command",
      detail: truncate(command),
      key: "shell",
    };
  }

  // ── Everything else, by what it does rather than what it is called.
  const generic = GENERIC_TOOLS[lower];
  if (generic) {
    const path = readString(input, ["file_path", "filePath", "path"]);
    const query = readString(input, ["pattern", "query", "url"]);
    return {
      title: generic.title,
      detail: path
        ? /^tool_[a-z0-9]/i.test(basename(path))
          ? "Previous tool output"
          : basename(path)
        : query
          ? truncate(query)
          : undefined,
      key: generic.key,
    };
  }

  return { title: humanize(name), key: `tool:${lower}` };
}
