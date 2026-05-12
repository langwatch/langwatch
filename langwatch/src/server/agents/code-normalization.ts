import type {
  AgentComponentConfig,
  AgentType,
} from "./agent.repository";
import type { CodeComponentConfig } from "~/optimization_studio/types/dsl";

/**
 * Normalize a Python source string the same way `textwrap.dedent` does:
 * find the longest common leading-whitespace prefix shared by every
 * non-blank line, strip it from each line, and trim a leading blank line
 * if present.
 *
 * Why: Monaco frequently inherits a common indent on paste (e.g. every
 * line starts with two spaces), which leaves the top-level `class` /
 * `def` / `import` statements indented relative to column 0. Black then
 * refuses to format the source at execute time and the user sees an
 * opaque HTTP 500 (issue #3013). Normalising at save time guarantees
 * the stored source parses cleanly at runtime.
 *
 * Mirrors CPython's `textwrap.dedent` semantics (lines containing only
 * whitespace are ignored when computing the common prefix and are
 * collapsed to empty after stripping).
 */
export function dedentPythonSource(source: string): string {
  if (source.length === 0) return source;

  const lines = source.split("\n");

  let commonPrefix: string | null = null;
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const match = /^[ \t]*/.exec(line);
    const indent = match ? match[0] : "";
    if (commonPrefix === null) {
      commonPrefix = indent;
      continue;
    }
    let i = 0;
    while (
      i < commonPrefix.length &&
      i < indent.length &&
      commonPrefix[i] === indent[i]
    ) {
      i++;
    }
    commonPrefix = commonPrefix.slice(0, i);
    if (commonPrefix === "") break;
  }

  const prefix = commonPrefix ?? "";
  const dedented =
    prefix.length === 0
      ? lines
      : lines.map((line) =>
          line.trim().length === 0
            ? line.replace(/^[ \t]+/, "")
            : line.startsWith(prefix)
              ? line.slice(prefix.length)
              : line,
        );

  let start = 0;
  while (start < dedented.length && dedented[start]?.trim().length === 0) {
    start++;
  }
  if (start === dedented.length) {
    return "";
  }
  return dedented.slice(start).join("\n");
}

/**
 * If `config` is a code-agent config, return a copy with the `code`
 * parameter dedented. Other agent types pass through unchanged.
 *
 * Called by the agents tRPC router (create + update) so any source
 * the user submits is normalised before it hits the database. The
 * downstream Python runtime still re-runs Black at execute time —
 * this is the cheap save-time guard, not a replacement for it.
 */
export function normalizeAgentConfigForType(
  type: AgentType,
  config: AgentComponentConfig,
): AgentComponentConfig {
  if (type !== "code") return config;

  const codeConfig = config as CodeComponentConfig;
  const params = codeConfig.parameters;
  if (!params) return config;

  let mutated = false;
  const nextParams = params.map((param) => {
    if (
      param.identifier === "code" &&
      param.type === "code" &&
      typeof param.value === "string"
    ) {
      const normalized = dedentPythonSource(param.value);
      if (normalized !== param.value) {
        mutated = true;
        return { ...param, value: normalized };
      }
    }
    return param;
  });

  if (!mutated) return config;
  return { ...codeConfig, parameters: nextParams };
}
