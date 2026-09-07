/**
 * Keeps `APP_ERROR_CODES` honest against the code actually raising errors.
 * @vitest-environment node
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { APP_ERROR_CODES } from "@langwatch/handled-error/app-codes";

const PACKAGE_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/**
 * Every tree that raises a handled error.
 */
const ROOTS = [
  join(PACKAGE_ROOT, "src"),
  // The two processes the verticals moved INTO. They raise codes this registry
  // has to carry copy for exactly as the application did — a guard that walked
  // only the tree being emptied would go quieter with every move, which is the
  // one direction a coverage guard must never drift.
  join(PACKAGE_ROOT, "../api/src"),
  join(PACKAGE_ROOT, "../worker/src"),
  // `ee` was a root until `4faa77c658` moved governance and SCIM into
  // `packages/enterprise`, which the packages root below already walks.
  join(PACKAGE_ROOT, "../../packages"),
].filter((root) => existsSync(root));

/**
 * Codes the ROOT workspace package raises rather than an app-level subclass, so
 * no amount of scanning the trees above will find their declaration —
 * `@langwatch/handled-error` lives outside `langwatch/`.
 */
const PACKAGE_OWNED_CODES = new Set(["validation_error"]);

/**
 * Codes MINTED at a relay boundary rather than declared by a subclass.
 */
const RELAYED_META_CODES = new Set(["missing_provider"]);

/**
 * Codes MINTED IN THE BROWSER, by narrowing a code we were already given.
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
 * Codes passed as a constructor PARAMETER — the shape the docblock above names as the
 * one this scanner cannot see, because there is no string literal at the declaration to
 * match.
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
 */
const NON_CODE_LITERALS = new Set(["unknown"]);

/**
 * One code per declaration shape, each chosen because the pattern for that shape is the
 * ONLY one that finds it.
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

/**
 * Codes that were already raised without customer copy when this guard was repaired,
 * and the three whose copy was already dead.
 */
const UNCOPIED_CODES_BACKLOG = new Set<string>([
  "annotation_annotator_invalid",
  "annotation_project_not_found",
  "annotation_queue_member_invalid",
  "annotation_score_invalid",
  "api_version_conflict",
  "api_version_unavailable",
  "authenticated_actor_required",
  "direct_upload_unavailable",
  "endpoint_withdrawn",
  "evaluator_config_invalid",
  "evaluator_copy_selection_invalid",
  "evaluator_invalid_type",
  "evaluator_is_not_copy",
  "evaluator_source_not_found",
  "evaluator_workflow_already_assigned",
  "evaluator_workflow_not_found",
  "feature_flag_experiment_unavailable",
  "feature_flag_experiment_unknown",
  "feature_flag_unknown",
  "group_membership_not_found",
  "idempotency_conflict",
  "invalid_api_version",
  "migration_drain_proof_requires_migrated",
  "model_cost_not_found",
  "model_default_not_found",
  "model_provider_invalid",
  "monitor_not_found",
  "organization_has_no_team",
  "project_input_mismatch",
  "prompt_handle_generation_failed",
  "prompt_system_prompt_conflict",
  "prompt_system_prompt_required",
  "prompt_tag_conflict",
  "prompt_tag_invalid",
  "prompt_tag_not_found",
  "prompt_tag_protected",
  "rate_limited",
  "secret_already_exists",
  "secret_limit_reached",
  "secret_name_reserved",
  "secret_not_found",
  "storage_unavailable",
  "stored_object_deleted",
  "stored_object_integrity_conflict",
  "stored_object_missing",
  "stored_object_not_found",
  "stored_object_unavailable",
  "team_custom_role_not_assignable",
  "team_custom_role_required",
  "team_membership_changed",
  "upload_checksum_mismatch",
  "upload_expired",
  "upload_failed",
  "upload_incomplete",
  "upload_token_invalid",
  "upload_too_large",
  "user_not_found",
  "webhook_endpoints_not_entitled",
  "workflow_dsl_invalid",
  "workflow_not_published",
  "workflow_version_not_found",
  "workflow_version_required",
]);

/** Copy that outlived the code raising it. Renames left these behind. */
const DEAD_COPY_BACKLOG = new Set<string>([
  "model_default_user_key_required",
  /**
   * Its declaring class went with `subscription/errors.ts` in 8a32e35208.
   */
  "subscription_service_unavailable",
  "system_prompt_conflict",
  "system_prompt_required",
]);

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
      const missing = [...declaredCodes()].filter(
        (code) => !listed.has(code) && !UNCOPIED_CODES_BACKLOG.has(code),
      );

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
          !PARAMETERIZED_CODES.has(code) &&
          !DEAD_COPY_BACKLOG.has(code),
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
