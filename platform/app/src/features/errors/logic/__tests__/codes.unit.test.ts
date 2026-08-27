/**
 * Keeps `APP_ERROR_CODES` honest against the code actually raising errors.
 *
 * The presentation registry is exhaustive over `AppErrorCode`, so that union is
 * what forces every error code to have customer-facing copy. A hand-maintained
 * list only holds that line if something notices when it drifts — TypeScript
 * can't, because there is no way to reflect over "every subclass of
 * HandledError in the program".
 *
 * So: scan the source for every code a `HandledError` subclass declares, and
 * fail on a mismatch in EITHER direction.
 *
 *   - a code raised but not listed  → an error with no copy would reach a user
 *   - a code listed but not raised  → dead copy, which is how the automations
 *     explainer ended up with a `recipient_not_in_team` branch for a code
 *     nothing throws
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { APP_ERROR_CODES } from "../codes";

const PACKAGE_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));

/**
 * Every tree that raises a handled error.
 *
 * One root more than the raw-toast guard walks: `noRawErrorToasts.unit.test.ts`
 * covers `src` and `ee` only, because it is looking for *renders* and the
 * workspace packages have no UI. Codes are declared in all three.
 *
 * `src` alone was a hole with no symptom: the Ops admin implementation
 * declares three codes and `packages/api` another, so none of the four entered
 * `APP_ERROR_CODES`, none was required to have copy, and the exhaustive
 * `satisfies` in `presentation.ts` had nothing to complain about. A guard that
 * only looks where the codes already are is a guard that passes forever.
 */
const ROOTS = [
  join(PACKAGE_ROOT, "src"),
  join(PACKAGE_ROOT, "ee"),
  // The workspace packages sit at the REPO root, not under the app — they were
  // lifted out of `platform/app/packages/` when the nine were consolidated into
  // one tree. Pointing this at the app-local path again would make the walk
  // silently skip them, which is the failure mode the docblock above describes.
  join(PACKAGE_ROOT, "../../packages"),
];

/**
 * Codes the ROOT workspace package raises rather than an app-level subclass, so
 * no amount of scanning the trees above will find their declaration —
 * `@langwatch/handled-error` lives outside `langwatch/`.
 */
const PACKAGE_OWNED_CODES = new Set(["validation_error"]);

/**
 * Codes MINTED at a relay boundary rather than declared by a subclass.
 *
 * `src/server/nlpgo/goHandledError.ts` promotes a relayed Go error's
 * `meta.reason` to the code when there is one, so a value written as `meta` in
 * Go (`{"reason": "missing_provider"}` in
 * `services/nlpgo/adapters/httpapi/playground_proxy.go`) arrives in the browser
 * as a first-class code. Nothing in these trees declares it, so no scan will
 * ever find it — but a customer reads it, so it still needs copy, and the
 * orphan check below must not call that copy dead.
 *
 * Keep this set small and each entry traceable to the `meta.reason` that mints
 * it. A code that only exists because of this promotion is a code no `herr.Code`
 * declares, which means `cmd/herrgen` cannot generate it either.
 */
const RELAYED_META_CODES = new Set(["missing_provider"]);

/**
 * Codes MINTED IN THE BROWSER, by narrowing a code we were already given.
 *
 * `promoteCodexAgentError` (`src/features/langy/logic/langyErrorExplainer.ts`)
 * takes the gateway's own code and re-keys it so Langy can say something the
 * generic entry cannot — a plan limit hit *through Langy* wants "start a new
 * conversation", where the gateway's version wants "upgrade". The server never
 * throws this code, so there is no `super("…")` to find; the declaration is a
 * spread on the client (`{ ...domain, code: "…" }`).
 *
 * It still reaches a customer and it still needs copy, so the orphan check must
 * not call that copy dead. The bar for adding one: the customer reads it, and
 * the narrowing genuinely changes the remediation. If the copy would be the
 * same as the code you narrowed from, alias it in `REGISTRY_CODE_ALIASES`
 * instead and do not enumerate it — which is exactly why the sibling
 * `langy_codex_session_expired` is absent from `APP_ERROR_CODES`.
 */
const CLIENT_MINTED_CODES = new Set([
  "langy_codex_plan_limit",
  // Thrown by the open workbench page, not by a handled error anywhere in
  // these trees: the page refuses an agent's action when the server already
  // holds a newer version, and the UI-action channel relays that code to the
  // agent inside `langy_ui_handler_failed`. A customer sees it too, in the
  // toast the page raises for a failed action.
  "langy_ui_page_out_of_date",
  // The sibling refusal from the same page, for a write that did not land for
  // any other reason. Also thrown in the browser, and relayed the same way.
  "langy_ui_save_failed",
  // Same shape, from `promoteModelUnavailableError`: the gateway's
  // `model_provider_not_bound` tells whoever configures a virtual key to bind
  // a provider to it or drop the prefix from the model name. In the panel the
  // model came from a menu, so the remediation is a different one and needs
  // its own words.
  "langy_model_unavailable",
]);

/**
 * Codes passed as a constructor PARAMETER — the shape the docblock above names
 * as the one this scanner cannot see, because there is no string literal at the
 * declaration to match.
 *
 * `LangyApiIdentityDeniedError` (the Langy contract errors) is one
 * class over three codes on purpose: all three are the same 403 with the same
 * body, and only the remediation differs (mint a personal key / ask an admin
 * for Langy access / the owner is gone). Its caller picks the code, so the
 * declaration is a union in the signature and every CODE_PATTERNS entry misses
 * it.
 *
 * These therefore enter `APP_ERROR_CODES` by hand, and the "raised but not
 * listed" assertion will NOT notice if a fourth is added to that union and left
 * off the list. That is the cost of the shape; the entry below is the record of
 * it. Adding a code here is a decision to hand-maintain it — prefer a subclass
 * with a literal unless the family genuinely shares one body.
 */
const PARAMETERIZED_CODES = new Set([
  "langy_api_key_unowned",
  "langy_api_key_no_langy_access",
  "langy_api_actor_missing",
]);

/**
 * A path typo turns this whole guard into a no-op, and it reports that as a
 * pass. The exact number is noise, but "we read thousands of files" and "we
 * read none" are worlds apart, and only one of them is a working guard.
 */
const MINIMUM_SCANNED_FILES = 500;

/**
 * The shapes a code is declared in, and the one this scanner CANNOT see.
 *
 *   `super("some_code", …)`                    — the common case
 *   `declare readonly code: "some_code"`        — subclass narrowing
 *   `code: "some_code"`                         — an options-object property
 *   `const { code = "some_code" } = options`    — a base class's default
 *   `new HandledError("some_code", …)`          — a one-off with no subclass
 *   `new NotFoundError("some_code", …)`         — the same, for the 404 base
 *
 * The last two are worth scanning even though subclasses are the norm: a
 * single permission denial doesn't earn a class, and a shape the scanner can't
 * see is a code that reaches a customer with no copy written for it. Adding
 * the `NotFoundError` shape found six live codes at once — `team_not_found`,
 * `workflow_not_found` and four more — none of which had any copy.
 *
 * **What it still cannot see: a code passed as a constructor PARAMETER.** A
 * class whose caller supplies the code (`new SomeError(code, …)`, or a factory
 * taking one) declares nothing this file can match, because there is no string
 * literal at the declaration at all. Those codes enter `APP_ERROR_CODES` only
 * by hand, and nothing here will notice if they don't. Prefer a subclass with
 * a literal, precisely so this guard can see it.
 *
 * `code: "…"` is a superset of the `declare readonly code:` pattern above; the
 * narrower one is kept because it names the shape a reader is looking for.
 */
const CODE_PATTERNS = [
  /super\(\s*"([a-z][a-z0-9_]*)"/g,
  /declare\s+(?:readonly\s+)?code:\s*"([a-z][a-z0-9_]*)"/g,
  /\bcode:\s*"([a-z][a-z0-9_]*)"/g,
  /\bcode\s*=\s*"([a-z][a-z0-9_]*)"/g,
  /new\s+HandledError\(\s*"([a-z][a-z0-9_]*)"/g,
  /new\s+NotFoundError\(\s*"([a-z][a-z0-9_]*)"/g,
];

/**
 * Strings that match a pattern above without being a raisable code.
 *
 * `unknown` is the sentinel a MASKED reason serialises as — `{ code:
 * "unknown" }` is how a non-handled link in the cause chain crosses the wire
 * (ADR-045). It is the absence of a code, so there is nothing to write copy
 * for and nothing to list.
 */
const NON_CODE_LITERALS = new Set(["unknown"]);

/**
 * One code per declaration shape, each chosen because the pattern for that
 * shape is the ONLY one that finds it.
 *
 * Without this, the "raised but not listed" assertion below gets *easier* to
 * pass as the patterns rot: a typo in one regex simply finds fewer codes, and
 * an empty `missing` list reads as a pass. These fail loudly instead.
 *
 * `declare readonly code:` has no witness of its own — every code written that
 * way is also found by the plain `code: "…"` pattern, so breaking the narrow
 * one cannot be detected from the outside.
 */
const SHAPE_WITNESSES: Record<string, string> = {
  'super("…", …)': "agent_report_rate_limited",
  'code = "…" (base-class default)': "suite_not_found",
  'new NotFoundError("…", …)': "team_not_found",
};

function isTestFile(path: string): boolean {
  return path.includes("__tests__") || /\.test\.tsx?$/.test(path);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(path, out);
    } else if (/\.tsx?$/.test(entry.name) && !isTestFile(path)) {
      out.push(path);
    }
  }
  return out;
}

function scannedFiles(): string[] {
  return ROOTS.flatMap((root) => walk(root));
}

function declaredCodes(): Set<string> {
  const found = new Set<string>();
  for (const file of scannedFiles()) {
    const source = readFileSync(file, "utf8");
    // Only files that actually deal in handled errors — `super("...")` is far
    // too common a shape to scan blind.
    if (!source.includes("@langwatch/handled-error")) continue;
    for (const pattern of CODE_PATTERNS) {
      for (const match of source.matchAll(pattern)) {
        if (match[1] && !NON_CODE_LITERALS.has(match[1])) found.add(match[1]);
      }
    }
  }
  return found;
}

describe("APP_ERROR_CODES", () => {
  describe("given the trees the guard walks", () => {
    it("reads a whole codebase, not an empty directory", () => {
      expect(
        scannedFiles().length,
        `The walk found almost nothing, so every assertion below passes ` +
          `vacuously. Check the roots resolve: ${ROOTS.join(", ")}.`,
      ).toBeGreaterThan(MINIMUM_SCANNED_FILES);
    });
  });

  describe("given the codes the source actually declares", () => {
    it.each(Object.entries(SHAPE_WITNESSES))(
      "still sees a code declared as %s",
      (_shape, witness) => {
        expect(
          [...declaredCodes()],
          `The scanner stopped finding "${witness}", which is declared in a ` +
            `shape only one CODE_PATTERNS entry matches. That pattern is ` +
            `broken, and every assertion below just got easier to pass.`,
        ).toContain(witness);
      },
    );

    /** @scenario "A new app code is caught by the suite first, then by the compiler" */
    /** @scenario "The list of app codes cannot drift from the code that raises them" */
    it("lists every code a HandledError subclass raises", () => {
      const listed = new Set<string>(APP_ERROR_CODES);
      const missing = [...declaredCodes()].filter((code) => !listed.has(code));

      expect(
        missing,
        `These handled-error codes are raised but missing from APP_ERROR_CODES, so ` +
          `no customer-facing copy is required for them. Add them to codes.ts and ` +
          `write their entry in presentation.ts.`,
      ).toEqual([]);
    });

    /** @scenario "The list of app codes cannot drift from the code that raises them" */
    it("lists no code that nothing raises", () => {
      const declared = declaredCodes();
      const orphans = APP_ERROR_CODES.filter(
        (code) =>
          !declared.has(code) &&
          !PACKAGE_OWNED_CODES.has(code) &&
          !RELAYED_META_CODES.has(code) &&
          !CLIENT_MINTED_CODES.has(code) &&
          !PARAMETERIZED_CODES.has(code),
      );

      expect(
        orphans,
        `These codes are in APP_ERROR_CODES but nothing raises them — the copy ` +
          `written for them is dead. Remove them, or find out why the error that ` +
          `used to throw them stopped.`,
      ).toEqual([]);
    });
  });

  it("holds no duplicates", () => {
    expect(APP_ERROR_CODES.length).toBe(new Set(APP_ERROR_CODES).size);
  });

  it("stays sorted, so a hand edit lands where the reader looks for it", () => {
    // Not a value echo — this asserts an invariant of the list's arrangement,
    // not its contents. The list is hand-maintained and every new code is an
    // insertion into it; once the order breaks, the next person inserts by
    // eye near the wrong neighbour and duplicates become easy to miss.
    expect([...APP_ERROR_CODES]).toEqual([...APP_ERROR_CODES].sort());
  });
});
