/**
 * Stops raw-message error toasts from growing back.
 *
 * `toaster.create({ description: error.message })` is the obvious thing to
 * write and it is wrong: since #5984 the wire message for a handled error is
 * its code, so this renders `validation_error` at a customer, and for an
 * unhandled error the message can carry internals. `showErrorToast` exists to
 * be the one correct way to do this.
 *
 * A type can't catch it — `error.message` is a perfectly good string — so it
 * is caught here instead, the same way `codes.unit.test.ts` catches an
 * unregistered code.
 *
 * The guard is deliberately structural rather than name-driven. Three earlier
 * versions matched on the *shape of the value only*, and every one of them was
 * defeated by writing the same leak slightly differently:
 *
 *  - hoist it into a local (`const message = e instanceof Error ? …`) and the
 *    slot holds a bare identifier, which reads as innocent;
 *  - rename the catch binding (`catch (problem)`, `const { error: saveError }`)
 *    and a closed `error|err|e|…` alternation can never match it;
 *  - write it as a JSX attribute (`fallbackTitle={error.message}`) and a
 *    pattern anchored on `key:` never sees it.
 *
 * So this file reads the file the way a reader does: it tracks which locals
 * hold an error, which identifiers were *bound* to one (catch clauses,
 * `onError` callbacks, `{ error: x }` destructures), and which call a copy
 * slot actually sits inside. Names are one signal of six, not the test.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));

/**
 * Both trees that ship UI. `ee/` was outside the original walk, so fourteen
 * raw-message toasts in the governance and backoffice dashboards were never
 * caught — the guard has to cover everywhere the pattern can appear, not just
 * where the migration happened to look.
 */
const ROOTS = ["src", "ee"].map((dir) => join(PACKAGE_ROOT, dir));

/**
 * Cheap substring test that decides whether a file is worth parsing.
 *
 * `setError` is in here because the form bridge is a second way to put copy in
 * front of a user: `FormServerError` renders `errors.root.serverError.message`
 * verbatim, so a hand-written `form.setError(FORM_SERVER_ERROR, { message:
 * error.message })` renders the code slug with nothing between it and the
 * customer — and such a file need never mention `toaster`.
 *
 * This prefilter is also the guard's single largest failure mode, which is why
 * {@link SCANNED_FILE_FLOOR} exists: rename the toaster module and this matches
 * nothing, the scan reports no offenders, and the guard stays green forever.
 */
const WORTH_SCANNING = /toaster|showErrorToast|HandledErrorAlert|setError/;

/**
 * Below this many scanned files, assume the prefilter has stopped matching
 * rather than that the codebase stopped toasting. Roughly 270 files match
 * today; the floor sits far enough below that normal churn doesn't trip it and
 * a rename does.
 */
const SCANNED_FILE_FLOOR = 200;

/** Copy slots a customer reads, in an object literal or a JSX attribute. */
const COPY_KEYS = new Set(["title", "description", "fallbackTitle"]);

/**
 * The calls whose arguments a customer reads.
 *
 * Requiring an enclosing call is what stops the guard firing on a table column
 * or a chart config that happens to live in a file which also toasts. Without
 * it the only fix available to an author is a file-level exemption, which
 * blinds the guard to that entire file — a worse outcome than the false
 * positive it was added to silence.
 *
 * `toaster` re-spreads `createToaster(...)` (see `components/ui/toaster.tsx`),
 * so `.error/.warning/.info/.success/.loading/.promise/.update` are all
 * first-class and all already used. A rule that knows only about `.create` is
 * one autocomplete away from being bypassed.
 */
const TOAST_CALL =
  /(?:^|[^\w$])toaster\s*\??\.\s*(?:create|error|warning|info|success|loading|promise|update)$|(?:^|[^\w$])showErrorToast$/;

/**
 * `form.setError(...)` — the form bridge renders its `message` verbatim.
 *
 * A bare `setError(…)` is far more often a `useState` setter, and one of those
 * holding a caught error's message (`setError(err instanceof Error ? …)`) is
 * not a toast at all. So a bare call only counts in a file that actually uses
 * react-hook-form; a member call (`form.setError`, `methods.setError`) always
 * does.
 */
const FORM_SET_ERROR_METHOD = /[\w$)\]]\s*\??\.\s*setError$/;
const BARE_SET_ERROR = /(?:^|[^\w$.])setError$/;
const USES_REACT_HOOK_FORM =
  /FORM_SERVER_ERROR|\buseForm\b|UseFormReturn|react-hook-form/;

/** JSX elements that present an error and take the same copy props. */
const ERROR_COMPONENT = /(?:^|\.)(?:HandledErrorAlert|ErrorAlert|ErrorCard)$/;

/**
 * Receivers whose `.message` is customer *data* we render on purpose.
 *
 * An ingested trace carries the error the customer's own system raised;
 * showing it is the entire point of the traces UI (`MessagesTable.tsx`,
 * `MessageCard.tsx`, `TraceMessages.tsx`, `SpanAccordions.tsx`). That has
 * nothing to do with the message of an error *we* threw, which is the thing
 * this guard is about.
 */
const SAFE_MESSAGE_RECEIVERS = new Set(["trace", "span"]);

/**
 * Names that mean "this holds an error", written open rather than closed.
 *
 * The previous closed alternation (`error|err|e|exception|cause|reason`) could
 * not match `saveError`, `apiError`, `failure`, `problem` or `ex`, all of
 * which appear in real catch clauses. This matches any name *ending* in an
 * error-ish word too, so the next invented spelling is covered by default.
 *
 * It is only ever the last signal consulted — see {@link isErrorExpression}.
 */
const ERROR_NAME =
  /^(?:e|ex|err|errs|error|errors|exception|exceptions|cause|reason|problem|failure|rejection|fault|[\w$]*(?:Error|Err|Exception|Failure|Problem|Rejection|Cause)s?)$/;

/**
 * Files allowed to reference an error message directly.
 *
 * Keep this list empty-ish and justified. It is not a place to park a
 * migration you didn't finish — and since a file-level exemption blinds the
 * guard to every future line in that file, prefer the per-line
 * `// no-raw-error-toast-ok` marker.
 */
const ALLOWED = new Set<string>([
  // This file. Its fixtures are deliberately written leaks — the detector's
  // own tests below assert each one is caught — so scanning itself would
  // always fail. Nothing else belongs here: `showErrorToast.ts` used to, but
  // its only `description: error.message` is inside a docblock, which
  // `stripComments` blanks, and an allowlist entry that isn't holding
  // anything back reads as permission to add more.
  "src/features/errors/logic/__tests__/noRawErrorToasts.unit.test.ts",
]);

/**
 * Per-line opt-out, for the rare line the guard is wrong about.
 *
 * One line is the right size for an exemption. A file-level entry in
 * {@link ALLOWED} silences every line the file will ever grow, which is how a
 * guard ends up scanning a large file and finding nothing by design.
 */
const SUPPRESSION_MARKER = "no-raw-error-toast-ok";

/* ------------------------------------------------------------------ */
/* Lexical helpers                                                     */
/* ------------------------------------------------------------------ */

/** Index of the closing quote of the string starting at `at`. */
function skipString(source: string, at: number): number {
  const quote = source[at];
  for (let scan = at + 1; scan < source.length; scan++) {
    if (source[scan] === "\\") {
      scan++;
      continue;
    }
    if (source[scan] === quote) return scan;
  }
  return source.length;
}

/**
 * Reads one property value, starting just after its `:` (or after the `{` of a
 * JSX expression container).
 *
 * A regex cannot do this correctly and two earlier versions of this guard
 * proved it. Bounding the value with `[^,;]` under-matched — it stopped at the
 * first comma, so `description: fmt("Couldn't save", error.message)` was
 * invisible — and over-matched, because with no comma or semicolon in the way
 * it ran off the end of the call into the next statement, so
 * `toast={{ title: "x" }}` followed by `onClick={() => log(error.message)}`
 * read as one value and would have been flagged.
 *
 * So: scan, tracking nesting and string state. The value ends at a `,` or `;`
 * at depth zero, or at the `}` that closes the object literal (or the JSX
 * expression container) it lives in. Strings and template literals are skipped
 * whole, so a brace or comma inside copy can't end the value early.
 */
function readValue(source: string, from: number): string {
  let depth = 0;
  let at = from;

  for (; at < source.length; at++) {
    const char = source[at]!;

    if (char === '"' || char === "'" || char === "`") {
      at = skipString(source, at);
      continue;
    }
    if (char === "(" || char === "[" || char === "{") depth++;
    else if (char === ")" || char === "]") {
      if (depth === 0) break;
      depth--;
    } else if (char === "}") {
      // Depth zero means this closes the object holding the property, so the
      // value ended here — this is what stops the scan escaping the call.
      if (depth === 0) break;
      depth--;
    } else if ((char === "," || char === ";") && depth === 0) break;
  }

  return source.slice(from, at);
}

/**
 * Blanks out comments so prose about the pattern isn't mistaken for a call
 * site, without moving anything: every stripped character becomes a space and
 * every newline survives, so match offsets still map to real line numbers.
 *
 * Trailing `//` comments are stripped too, which the line-oriented version
 * couldn't do. That version only blanked lines that were *entirely* a comment,
 * so writing about the antipattern at the end of a line of code fired the
 * guard, and the only way out was a file-level exemption. It avoided trailing
 * comments because a naive strip eats the `//` in a `https://` inside a
 * string; this scanner tracks quote state, so it doesn't have to.
 *
 * Two deliberate blind spots remain, both erring towards reading one comment
 * too many rather than blinding the guard: a `//` immediately after `:` or a
 * backslash is left alone, because those are how a URL and a regex's escaped
 * slash (`/https?:\/\//`) end up looking like a comment opener.
 */
function stripComments(source: string): string {
  const out = source.split("");
  let quote: string | null = null;
  let at = 0;

  while (at < source.length) {
    const char = source[at]!;

    if (quote) {
      if (char === "\\") {
        at += 2;
        continue;
      }
      // An unterminated `'`/`"` is a mis-read (a regex character class such as
      // /["']/ looks exactly like an opening quote), so give up the state at
      // the newline instead of treating the rest of the file as a string.
      if (char === quote || (quote !== "`" && char === "\n")) quote = null;
      at++;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      at++;
      continue;
    }

    if (char === "/" && source[at + 1] === "*") {
      const closed = source.indexOf("*/", at + 2);
      const stop = closed === -1 ? source.length : closed + 2;
      for (let scan = at; scan < stop; scan++) {
        if (out[scan] !== "\n") out[scan] = " ";
      }
      at = stop;
      continue;
    }

    if (
      char === "/" &&
      source[at + 1] === "/" &&
      source[at - 1] !== "\\" &&
      source[at - 1] !== ":"
    ) {
      let stop = source.indexOf("\n", at);
      if (stop === -1) stop = source.length;
      for (let scan = at; scan < stop; scan++) out[scan] = " ";
      at = stop;
      continue;
    }

    at++;
  }

  return out.join("");
}

function lineOf(source: string, index: number): number {
  let line = 1;
  for (let at = 0; at < index; at++) if (source[at] === "\n") line++;
  return line;
}

/** Lines carrying the per-line opt-out, read before comments are blanked. */
function suppressedLines(raw: string): Set<number> {
  const lines = new Set<number>();
  raw.split("\n").forEach((line, index) => {
    if (line.includes(SUPPRESSION_MARKER)) lines.add(index + 1);
  });
  return lines;
}

/* ------------------------------------------------------------------ */
/* Expression reading                                                  */
/* ------------------------------------------------------------------ */

/** Index of the `(`/`[` matching the closer at `closeAt`, or -1. */
function matchOpenBackwards(text: string, closeAt: number): number {
  const close = text[closeAt]!;
  const open = close === ")" ? "(" : "[";
  let depth = 0;

  for (let scan = closeAt; scan >= 0; scan--) {
    const char = text[scan]!;
    if (char === close) depth++;
    else if (char === open && --depth === 0) return scan;
  }
  return -1;
}

/**
 * The member expression immediately left of `at` — the receiver of whatever
 * comes next.
 *
 * Walks over identifiers, dots, optional chaining and balanced `(…)`/`[…]`
 * groups, so `(error as Error)`, `errors[0]?` and `result.error` all come back
 * whole. That matters because the cast and the index are exactly where the
 * error name stops being adjacent to `.message`.
 */
function pathBefore(text: string, at: number): string {
  let end = at;
  while (end > 0 && /\s/.test(text[end - 1]!)) end--;
  let scan = end - 1;

  while (scan >= 0) {
    const char = text[scan]!;
    if (/[\w$.?!]/.test(char)) {
      scan--;
      continue;
    }
    if (char === ")" || char === "]") {
      const open = matchOpenBackwards(text, scan);
      if (open < 0) break;
      scan = open - 1;
      continue;
    }
    break;
  }

  return text.slice(scan + 1, end);
}

/** The leftmost identifier of a member expression. */
function rootOf(path: string): string | null {
  return /[A-Za-z_$][\w$]*/.exec(path)?.[0] ?? null;
}

interface FileFacts {
  /** Identifiers bound to an error by the language, whatever they're called. */
  errorBindings: Set<string>;
  /** Locals assigned from an expression that would itself leak. */
  tainted: Set<string>;
  /** Whether a bare `setError(…)` in this file can be the form bridge. */
  usesReactHookForm: boolean;
}

/**
 * Does this expression evaluate to an error we threw?
 *
 * Six signals, checked in order of how much they actually prove. The name is
 * last on purpose: `catch (problem)` and `onError: (failure) => …` are caught
 * by the binding, not by guessing what people call things.
 */
function isErrorExpression(path: string, facts: FileFacts): boolean {
  const root = rootOf(path);
  if (!root) return false;
  if (SAFE_MESSAGE_RECEIVERS.has(root)) return false;
  if (/[.?]\s*(?:error|cause|reason)\b/.test(path)) return true;
  if (facts.errorBindings.has(root)) return true;
  if (facts.tainted.has(root)) return true;
  return ERROR_NAME.test(root);
}

/** `.message` read off something that holds one of our errors. */
function readsErrorMessage(value: string, facts: FileFacts): boolean {
  for (const match of value.matchAll(/\??\s*\.\s*message\b/g)) {
    if (isErrorExpression(pathBefore(value, match.index), facts)) return true;
  }
  return false;
}

/**
 * The other spellings of the same leak.
 *
 * `String(error)` was the only one the previous version knew, so
 * `JSON.stringify(err)`, `err.toString()` and `String(err.cause)` all shipped
 * a raw error to a customer while the guard reported a clean tree.
 */
function stringifiesError(value: string, facts: FileFacts): boolean {
  for (const match of value.matchAll(
    /\b(?:String|JSON\s*\.\s*stringify)\s*\(/g,
  )) {
    const argument = readValue(value, match.index + match[0].length);
    if (isErrorExpression(argument, facts)) return true;
  }
  for (const match of value.matchAll(/\??\s*\.\s*toString\s*\(/g)) {
    if (isErrorExpression(pathBefore(value, match.index), facts)) return true;
  }
  return false;
}

/** A local that already holds an error's message, used as copy. */
function usesTaintedLocal(value: string, facts: FileFacts): boolean {
  for (const match of value.matchAll(/[A-Za-z_$][\w$]*/g)) {
    if (value[match.index - 1] === ".") continue;
    if (facts.tainted.has(match[0])) return true;
  }
  return false;
}

function valueLeaks(value: string, facts: FileFacts): boolean {
  return (
    readsErrorMessage(value, facts) ||
    stringifiesError(value, facts) ||
    usesTaintedLocal(value, facts)
  );
}

/* ------------------------------------------------------------------ */
/* File-level facts                                                    */
/* ------------------------------------------------------------------ */

/** `catch (x)`, `onError: (x) =>`, `.catch((x) =>`, `{ error: x }`. */
const ERROR_BINDING =
  /\bcatch\s*\(\s*([A-Za-z_$][\w$]*)|\bonError\s*:\s*(?:async\s*)?\(?\s*([A-Za-z_$][\w$]*)|\.\s*catch\s*\(\s*(?:async\s*)?\(?\s*([A-Za-z_$][\w$]*)|\b(?:error|err|cause|exception)\s*:\s*([A-Za-z_$][\w$]*)\s*[,}=]/g;

function collectErrorBindings(source: string): Set<string> {
  const bound = new Set<string>();
  for (const match of source.matchAll(ERROR_BINDING)) {
    const name = match[1] ?? match[2] ?? match[3] ?? match[4];
    if (name) bound.add(name);
  }
  return bound;
}

const DECLARATION =
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;\n]*?)?\s*=(?!=)\s*/g;

/**
 * Locals holding an error's message.
 *
 * This is the shape the guard missed most often, and the one people reach for
 * without thinking:
 *
 * ```ts
 * const message = e instanceof Error ? e.message : "Failed to save";
 * toaster.create({ title: message, type: "error" });
 * ```
 *
 * Both halves read as innocent on their own. Run to a fixpoint so a message
 * laundered through a second local (`const shown = message;`) is caught too.
 */
function collectTaint(source: string, facts: FileFacts): Set<string> {
  const { tainted } = facts;

  for (let round = 0; round < 3; round++) {
    const before = tainted.size;
    for (const match of source.matchAll(DECLARATION)) {
      const name = match[1]!;
      if (tainted.has(name)) continue;
      const value = readValue(source, match.index + match[0].length);
      if (valueLeaks(value, facts)) tainted.add(name);
    }
    if (tainted.size === before) break;
  }

  return tainted;
}

/* ------------------------------------------------------------------ */
/* Slot scanning                                                       */
/* ------------------------------------------------------------------ */

interface Frame {
  kind: "call" | "group" | "jsx";
  name: string;
}

interface Slot {
  key: string;
  keyAt: number;
  /** Where the value starts, or the value itself for a shorthand property. */
  valueAt: number;
  shorthand: boolean;
  frame: Frame | null;
}

/**
 * `key: value`, `"key": value` and `key={value}`.
 *
 * The JSX form is why `[:=]` is here. Anchoring on `key:` alone meant
 * `<HandledErrorAlert fallbackTitle={error.message} />` was caught by neither
 * guard — while `HandledErrorAlert` sat in the file prefilter, which reads as
 * coverage that did not exist.
 */
const SLOT_AT =
  /["']?(title|description|fallbackTitle|message)["']?\s*[:=](?!=)\s*(\{)?/y;

/** `{ description }` / `, description }` — shorthand for `description: description`. */
const SHORTHAND_AT =
  /[{,]\s*(title|description|fallbackTitle|message)\s*(?=[,}])/y;

/** The identifier or member expression being called at `parenAt`. */
function calleeBefore(source: string, parenAt: number): string {
  let end = parenAt;
  while (end > 0 && /\s/.test(source[end - 1]!)) end--;
  let scan = end - 1;
  while (scan >= 0 && /[\w$.?]/.test(source[scan]!)) scan--;
  return source.slice(scan + 1, end);
}

/** Is the `<` at `at` a JSX element rather than a comparison or a generic? */
function isJsxOpen(source: string, at: number): boolean {
  if (!/[A-Za-z_$]/.test(source[at + 1] ?? "")) return false;
  const before = source.slice(0, at).trimEnd();
  const last = before.at(-1) ?? "";
  if (last === "") return true;
  if ("(=>,{[?:;&|)}".includes(last)) return true;
  return /\b(?:return|case|default|yield|await|typeof)$/.test(before);
}

/** The call or JSX element a slot's value is an argument of. */
function nearestNamedFrame(stack: Frame[]): Frame | null {
  for (let at = stack.length - 1; at >= 0; at--) {
    const frame = stack[at]!;
    if (frame.kind !== "group") return frame;
  }
  return null;
}

/**
 * Walks a file once, recording every copy slot together with the call it sits
 * inside.
 *
 * The stack is the point. Without it a `title:` in a table column definition,
 * a chart option or a `useQuery` config counts the moment the file mentions
 * `toaster` anywhere — and the cheapest way for an author to silence that is a
 * file-level exemption, which turns the guard off for the whole file.
 */
function scanSlots(source: string): Slot[] {
  const slots: Slot[] = [];
  const stack: Frame[] = [];

  for (let at = 0; at < source.length; at++) {
    const char = source[at]!;

    // The `.`/`?` in the guard is load-bearing: without it the `:` of a
    // ternary turns a *read* into a key, so `err.message : String(err)` parsed
    // as `message: String(err)` and flagged a `useState` setter.
    if (/["'tdfm]/.test(char) && !/[\w$.?]/.test(source[at - 1] ?? "")) {
      SLOT_AT.lastIndex = at;
      const slot = SLOT_AT.exec(source);
      if (slot) {
        const opensBrace = slot[2] !== undefined;
        slots.push({
          key: slot[1]!,
          keyAt: at,
          valueAt: SLOT_AT.lastIndex,
          shorthand: false,
          frame: nearestNamedFrame(stack),
        });
        // Resume *at* the `{` of a JSX expression container so it still pushes
        // its frame; otherwise resume just past the separator.
        at = (opensBrace ? SLOT_AT.lastIndex - 1 : SLOT_AT.lastIndex) - 1;
        continue;
      }
    }

    if (char === "{" || char === ",") {
      SHORTHAND_AT.lastIndex = at;
      const shorthand = SHORTHAND_AT.exec(source);
      if (shorthand) {
        slots.push({
          key: shorthand[1]!,
          keyAt: SHORTHAND_AT.lastIndex - shorthand[1]!.length,
          valueAt: SHORTHAND_AT.lastIndex - shorthand[1]!.length,
          shorthand: true,
          frame: nearestNamedFrame(stack),
        });
      }
    }

    if (char === '"' || char === "'" || char === "`") {
      at = skipString(source, at);
      continue;
    }
    if (char === "(") {
      stack.push({ kind: "call", name: calleeBefore(source, at) });
      continue;
    }
    if (char === "[" || char === "{") {
      stack.push({ kind: "group", name: "" });
      continue;
    }
    if (char === ")" || char === "]" || char === "}") {
      stack.pop();
      continue;
    }
    if (char === "<" && isJsxOpen(source, at)) {
      const tag = /[\w$.]+/.exec(source.slice(at + 1))?.[0] ?? "";
      stack.push({ kind: "jsx", name: tag });
      continue;
    }
    if (char === ">" && stack.at(-1)?.kind === "jsx") {
      // Attributes end at the tag's `>`; children are not attributes.
      stack.pop();
    }
  }

  return slots;
}

/** Is this slot somewhere a customer reads? */
function slotIsCopy(slot: Slot, facts: FileFacts): boolean {
  const frame = slot.frame;
  if (!frame) return false;
  if (frame.kind === "jsx") {
    return ERROR_COMPONENT.test(frame.name) && COPY_KEYS.has(slot.key);
  }
  if (TOAST_CALL.test(frame.name)) return COPY_KEYS.has(slot.key);
  // `FormServerError` renders `errors.root.serverError.message` verbatim, so
  // the form bridge's `message` is customer copy in every sense that matters.
  if (
    FORM_SET_ERROR_METHOD.test(frame.name) ||
    (facts.usesReactHookForm && BARE_SET_ERROR.test(frame.name))
  ) {
    return slot.key === "message";
  }
  return false;
}

/** The detector, isolated from the filesystem walk so it can be tested. */
function findLeaks(raw: string): number[] {
  const source = stripComments(raw);
  const suppressed = suppressedLines(raw);
  const facts: FileFacts = {
    errorBindings: collectErrorBindings(source),
    tainted: new Set<string>(),
    usesReactHookForm: USES_REACT_HOOK_FORM.test(source),
  };
  collectTaint(source, facts);

  const lines: number[] = [];
  for (const slot of scanSlots(source)) {
    if (!slotIsCopy(slot, facts)) continue;
    const value = slot.shorthand ? slot.key : readValue(source, slot.valueAt);
    if (!valueLeaks(value, facts)) continue;
    const line = lineOf(source, slot.keyAt);
    if (suppressed.has(line)) continue;
    lines.push(line);
  }
  return lines;
}

const leaksIn = (source: string): boolean => findLeaks(source).length > 0;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(path, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

/**
 * The detector's own tests.
 *
 * Without these, "no offenders" is indistinguishable from "detects nothing" —
 * and this guard has twice shipped in the second state while reporting the
 * first. Every LEAKS case is a shape that reached a customer, or would have.
 */
describe("the raw-message detector", () => {
  describe("given a leak", () => {
    it.each([
      ["flat", `toaster.create({ description: error.message })`],
      ["in the title", `toaster.create({ title: error.message })`],
      ["as-cast", `toaster.create({ description: (error as Error).message })`],
      [
        "property-access cast",
        `toaster.create({ description: String((err as { message: unknown }).message) })`,
      ],
      [
        "wrapped onto the next line by the formatter",
        `toaster.create({\n  description:\n    err instanceof Error ? err.message : "x",\n})`,
      ],
      [
        "inside a template literal",
        "toaster.create({ description: `Failed: ${error.message}` })",
      ],
      [
        "behind a comma, inside a call",
        `toaster.create({ description: fmt("Couldn't save", error.message) })`,
      ],
      [
        "joined from an array",
        `toaster.create({ description: [prefix, error.message].join(" ") })`,
      ],
      [
        "in showErrorToast's own fallback",
        `showErrorToast({ error, fallbackTitle: error.message })`,
      ],
      ["stringified", `toaster.create({ description: String(error) })`],
    ])("catches it %s", (_shape, source) => {
      expect(leaksIn(source)).toBe(true);
    });

    it.each([
      [
        "hoisted into a local",
        `const message = e instanceof Error ? e.message : "Failed to save";\ntoaster.create({ title: message, type: "error" });`,
      ],
      [
        "hoisted and then laundered through a second local",
        `const message = err.message;\nconst shown = message;\ntoaster.create({ description: shown })`,
      ],
      [
        "hoisted into a shorthand property",
        `const description = error.message;\ntoaster.create({ description })`,
      ],
      [
        "JSON.stringified",
        `toaster.create({ description: JSON.stringify(err) })`,
      ],
      ["via toString", `toaster.create({ description: err.toString() })`],
      [
        "stringified off the cause",
        `toaster.create({ description: String(err.cause) })`,
      ],
    ])("catches a message %s", (_shape, source) => {
      expect(leaksIn(source)).toBe(true);
    });

    it.each([
      [
        "a renamed catch binding",
        `try { save() } catch (problem) { toaster.create({ description: problem.message }) }`,
      ],
      [
        "a destructured rename",
        `const { error: saveError } = await save();\ntoaster.create({ description: saveError.message })`,
      ],
      [
        "an onError callback parameter",
        `useMutation({ onError: (whatever) => toaster.create({ description: whatever.message }) })`,
      ],
      ["a suffixed name", `toaster.create({ description: apiError.message })`],
      ["the name failure", `toaster.create({ description: failure.message })`],
      ["the name ex", `toaster.create({ description: ex.message })`],
    ])("catches it under %s", (_shape, source) => {
      expect(leaksIn(source)).toBe(true);
    });

    it.each([
      [
        "a JSX attribute on an error component",
        `<HandledErrorAlert error={error} fallbackTitle={error.message} />`,
      ],
      [
        "a quoted key",
        `toaster.create({ "description": error.message, type: "error" })`,
      ],
      [
        "a toaster shorthand method",
        `toaster.error({ description: error.message })`,
      ],
      [
        "the form bridge",
        `form.setError(FORM_SERVER_ERROR, { message: error.message })`,
      ],
      [
        "the form bridge destructured out of useForm",
        `const { setError } = useForm();\nsetError(FORM_SERVER_ERROR, { message: error.message })`,
      ],
    ])("catches it written as %s", (_shape, source) => {
      expect(leaksIn(source)).toBe(true);
    });
  });

  describe("given something that only looks like one", () => {
    it.each([
      [
        "a real message that isn't an error's",
        `toaster.create({ description: notification.message })`,
      ],
      ["plain copy", `toaster.create({ description: "Something went wrong" })`],
      [
        "a correct call",
        `showErrorToast({ error, fallbackTitle: "Couldn't save" })`,
      ],
      [
        "a map parameter named e",
        "items.map((e) => toaster.create({ title: `${e.label}` }))",
      ],
      [
        "an unrelated statement after the call",
        `toaster.create({ title: "Failed" })\nconsole.error(error.message)`,
      ],
      [
        "a JSX prop object followed by a handler",
        `<Toast toast={{ title: "x" }} onClick={() => log(error.message)} />`,
      ],
      [
        "the pattern described in a comment",
        `// never write description: error.message\ntoaster.create({ description: "ok" })`,
      ],
      [
        "the pattern described in a trailing comment",
        `toaster.create({ description: "ok" }) // not description: error.message`,
      ],
      [
        "a success payload's own message",
        `toaster.create({ title: "Dry run complete", description: data.message, type: "info" })`,
      ],
      [
        "a parse result's own message",
        `toaster.create({ title: "Invalid filter", description: parsed.message })`,
      ],
      [
        "an ingested trace's error, which is customer data",
        `toaster.create({ description: trace.error.message })`,
      ],
    ])("stays quiet about %s", (_shape, source) => {
      expect(leaksIn(source)).toBe(false);
    });
  });

  describe("given a copy slot outside any toast", () => {
    it.each([
      [
        "a config object in a file that also toasts",
        `toaster.create({ title: "Failed" });\nconst columns = [{ title: error.message }];`,
      ],
      [
        "a JSX attribute on an ordinary component",
        `<Tooltip title={error.message} />`,
      ],
      [
        "an interface declaring the same property names",
        `interface Props { title: string; description: string }\ntoaster.create({ title: "ok" })`,
      ],
      [
        "a useState setter that happens to be called setError",
        `const [, setError] = useState<string | null>(null);\ntry { render() } catch (err) { setError(err instanceof Error ? err.message : String(err)) }`,
      ],
    ])("stays quiet about %s", (_shape, source) => {
      expect(leaksIn(source)).toBe(false);
    });
  });

  describe("when a line carries the opt-out marker", () => {
    it("stays quiet about that line only", () => {
      const source = [
        `toaster.create({ description: error.message }); // ${SUPPRESSION_MARKER}`,
        `toaster.create({ description: error.message });`,
      ].join("\n");

      expect(findLeaks(source)).toEqual([2]);
    });
  });

  describe("when the same file leaks more than once", () => {
    it("reports every line rather than stopping at the first", () => {
      const source = [
        `toaster.create({ description: error.message });`,
        `showErrorToast({ error, fallbackTitle: err.message });`,
      ].join("\n");

      expect(findLeaks(source)).toEqual([1, 2]);
    });
  });
});

describe("error toasts", () => {
  it("never render an error's raw message", () => {
    const offenders: string[] = [];
    let scanned = 0;

    for (const file of ROOTS.flatMap((root) => walk(root))) {
      const rel = relative(PACKAGE_ROOT, file);
      if (ALLOWED.has(rel)) continue;

      const raw = readFileSync(file, "utf8");
      // `showErrorToast` does not contain the substring "toaster", so testing
      // for "toaster" alone skipped every file that had already migrated —
      // exactly the files where `fallbackTitle: error.message` can appear.
      if (!WORTH_SCANNING.test(raw)) continue;

      scanned++;
      for (const line of findLeaks(raw)) offenders.push(`${rel}:${line}`);
    }

    expect(
      scanned,
      `The guard scanned ${scanned} files, which is too few to be believable — ` +
        `the substring prefilter (${String(WORTH_SCANNING)}) has almost ` +
        `certainly stopped matching, most likely because a module it names was ` +
        `renamed. A guard that scans nothing reports no offenders forever. Fix ` +
        `the prefilter rather than the floor.`,
    ).toBeGreaterThan(SCANNED_FILE_FLOOR);

    expect(
      offenders,
      `These toasts render an error's raw message. For a handled error that is ` +
        `the code slug (the customer reads "validation_error"); for an unhandled ` +
        `one it can leak internals. Use showErrorToast({ error, fallbackTitle }) ` +
        `from ~/features/errors instead — see ` +
        `dev/docs/best_practices/error-handling.md. If a line is genuinely fine, ` +
        `mark that one line with // ${SUPPRESSION_MARKER} rather than exempting ` +
        `the whole file.`,
    ).toEqual([]);
  });
});
