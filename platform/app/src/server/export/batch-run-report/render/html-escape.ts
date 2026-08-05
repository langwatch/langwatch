/**
 * Escaping for the run report document.
 *
 * The report renders run data and model-authored prose into a file that is
 * opened straight from disk, with no server and no CSP to fall back on. v1
 * therefore treats every string as TEXT: there is no markdown pass and no
 * sanitiser allowlist, because an allowlist is a list of things that can still
 * go wrong, and nothing in the report needs markup it did not author itself.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const ESCAPABLE = /[&<>"']/g;

function escapeChars(value: string): string {
  return value.replace(ESCAPABLE, (char) => HTML_ENTITIES[char] ?? char);
}

/** Escapes a string destined for a text node. */
export function escapeHtml(value: string): string {
  return escapeChars(value);
}

/**
 * Escapes a string destined for an attribute value.
 *
 * Identical to {@link escapeHtml} today. It exists as its own name so call
 * sites declare which context they are in, which is what lets attribute
 * escaping tighten later without re-auditing every text node in the renderer.
 */
export function escapeAttr(value: string): string {
  return escapeChars(value);
}
