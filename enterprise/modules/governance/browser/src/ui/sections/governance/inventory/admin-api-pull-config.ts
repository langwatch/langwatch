// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Temporal } from "@langwatch/time";

import { PULL_SCHEDULE_DEFAULTS } from "../../../../features/ingestion-sources/model/pull-cadence.ts";
import { ANTHROPIC_BUCKET_WIDTHS } from "./parser-field-controls.ts";
import type { ComposerState } from "./source-composer-state.ts";

/**
 * The Claude Enterprise Compliance adapter config, or null when a new source
 * names no workspace API key.
 *
 * The adapter's shape is frozen — `ClaudeComplianceReferencePuller.validateConfig`
 * returns `CLAUDE_COMPLIANCE_PULL_CONFIG` whatever is stored — so the only
 * thing this builder has to get right is the credential: the frozen header
 * reads `${{credentials.token}}`, and `credentials` is the one subtree the
 * server encrypts. Everything else the form collects (the polling cadence)
 * keeps travelling through `buildParserConfig` exactly as before.
 *
 * The adapter id is written explicitly rather than copied from the frozen
 * config, which names the generic `http_polling` adapter it is built on:
 * `resolvePullAdapter` dispatches on this field, so copying it would run the
 * generic puller in place of this one. The frozen config is not imported here
 * at all — it lives in a server puller module, and pulling that into the
 * inventory page would drag the puller stack into the browser bundle.
 *
 * `shouldRequireCredentials` carries the same meaning as it does for the two
 * Admin builders below: on edit a blank key means "leave it alone", so the
 * key is OMITTED rather than emitted empty, because `updateSource` carries the
 * stored envelope across only for a key that is genuinely absent.
 *
 * NEITHER PATH REACHES THIS BUILDER TODAY. The type is `deprecated` in the
 * catalog, so the create picker never offers it, and it is absent from
 * `EDITABLE_PULL_CONFIG_SOURCE_TYPES`, so `buildEditSubmission` never asks
 * for it. The builder exists so that the day the type is offered again, the
 * secret already lands where the adapter reads it (#7583) instead of under
 * the old `workspaceApiKey` name the adapter never looked at. The coverage
 * guard in `pullConfigBuilderCoverage.unit.test.ts` is what keeps it wired.
 */
export function buildClaudeCompliancePullConfig(
  c: ComposerState,
  { shouldRequireCredentials = true }: { shouldRequireCredentials?: boolean } = {},
): Record<string, unknown> | null {
  const token = trimmedField(c.parserConfig, "credentialsToken");
  if (!token && shouldRequireCredentials) return null;

  return {
    adapter: "claude_compliance",
    schedule: c.pullSchedule.trim() || PULL_SCHEDULE_DEFAULTS.claude_compliance || "*/15 * * * *",
    ...(token ? { credentials: { token } } : {}),
  };
}

/**
 * The Anthropic Admin adapter config, or null when a required field is empty
 * or `report` is not one of the two values the adapter accepts. Nothing
 * validates pullConfig against the adapter schema at save time — a bad value
 * here would sit in the row looking fine and fail on every pull — so the
 * builder is the last checkpoint before the database.
 *
 * `shouldRequireCredentials` is the one thing that differs between creating a source
 * and editing one, and it defaults to the stricter case. On create there is no
 * stored secret to fall back on, so a blank token is a broken source. On edit
 * the secret is never shown — `toDto` strips it — so a blank token means
 * "leave it alone", and the key must be OMITTED rather than emitted empty:
 * `updateSource` carries the stored envelope across only for a key that is
 * genuinely absent, so `credentials: { token: "" }` would overwrite a working
 * key with an empty one and break the source on its next run.
 *
 * Every other check stays shared. Forking a second builder for the edit form
 * is how the two paths would drift into disagreeing about which reports the
 * adapter accepts, or which start dates it can read.
 */
export function buildAnthropicAdminPullConfig(
  c: ComposerState,
  { shouldRequireCredentials = true }: { shouldRequireCredentials?: boolean } = {},
): Record<string, unknown> | null {
  const p = c.parserConfig;
  const token = trimmedField(p, "credentialsToken");
  const report = trimmedField(p, "report").toLowerCase();
  if (!token && shouldRequireCredentials) return null;
  if (report !== "usage" && report !== "cost") return null;

  const bucketWidth = bucketWidthToStore(trimmedField(p, "bucketWidth"), report);

  const startingAt = normalizeStartingAt(trimmedField(p, "startingAt"));
  if (startingAt === null) return null;

  return {
    adapter: "anthropic_admin",
    report,
    ...(bucketWidth ? { bucketWidth } : {}),
    ...(startingAt ? { startingAt } : {}),
    schedule: c.pullSchedule.trim() || PULL_SCHEDULE_DEFAULTS.anthropic_admin || "0 * * * *",
    ...(token ? { credentials: { token } } : {}),
  };
}

/**
 * The OpenAI Admin adapter config, or null when a required field is empty or
 * the backfill start is not a date the adapter will accept. Nothing validates
 * pullConfig against the adapter schema at save time, so the builder is the
 * last checkpoint before the database.
 *
 * There is no report to choose: the adapter pulls the cost report and only the
 * cost report, because the provider's usage surface returns nothing for spend
 * the cost surface bills. `shouldRequireCredentials` carries the same meaning
 * as it does for Anthropic above — on edit a blank key means "leave it alone",
 * so the key must be OMITTED rather than written empty.
 */
export function buildOpenAiAdminPullConfig(
  c: ComposerState,
  { shouldRequireCredentials = true }: { shouldRequireCredentials?: boolean } = {},
): Record<string, unknown> | null {
  const p = c.parserConfig;
  const token = trimmedField(p, "credentialsToken");
  if (!token && shouldRequireCredentials) return null;

  const startingAt = normalizeStartingAt(trimmedField(p, "startingAt"));
  if (startingAt === null) return null;

  return {
    adapter: "openai_admin",
    report: "cost",
    ...(startingAt ? { startingAt } : {}),
    schedule: c.pullSchedule.trim() || PULL_SCHEDULE_DEFAULTS.openai_admin || "0 * * * *",
    ...(token ? { credentials: { token } } : {}),
  };
}

/** One composer field, trimmed, with an absent key reading as empty. */
function trimmedField(p: Record<string, string>, key: string): string {
  return (p[key] ?? "").trim();
}

/**
 * The bucket width to store, or undefined to leave the key out entirely.
 *
 * The form stopped asking, so this is the only thing deciding what happens to a
 * width a source is already holding — and it can no longer refuse one. A
 * refusal would block the save over a control that is not on the screen, which
 * on the old picker was at least a field the admin could see and correct.
 *
 * Cost drops any held width. The puller sends `COST_REPORT_BUCKET_WIDTH` and
 * deliberately ignores `config.bucketWidth`, so a width stored on a cost source
 * was never in effect and there is nothing to preserve.
 *
 * Usage keeps a width the adapter still honours, and otherwise writes daily.
 * Keeping it is what makes withdrawing the question safe: the finer widths are
 * taken off new sources, not off the sources already being read at one, and an
 * admin editing a name has not asked for a settings change. Writing `1d` rather
 * than omitting it is deliberate — the adapter defaults to daily too, but a
 * stored config that says nothing cannot be told from one saved before the
 * field existed, and this source runs daily either way.
 */
function bucketWidthToStore(raw: string, report: string): string | undefined {
  if (report !== "usage") return undefined;
  return (ANTHROPIC_BUCKET_WIDTHS as readonly string[]).includes(raw) ? raw : "1d";
}

/** Whether y-m-d is a date that exists, rather than one Date would roll forward. */
function isRealCalendarDate(year: number, month: number, day: number): boolean {
  try {
    return Temporal.PlainDate.from({ year, month, day }).toString() !== "";
  } catch {
    return false;
  }
}

/**
 * A bare `YYYY-MM-DD`, or a timestamp carrying an explicit offset. Anything else
 * is rejected rather than guessed.
 *
 * The two shapes are the ones `Date.parse` reads unambiguously. An offset-less
 * `2026-08-01T00:00` is spec'd as *local* time, so the same typed value would
 * mean a different instant for an admin in Amsterdam than one in Tokyo.
 */
const STARTING_AT =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/;

/**
 * ISO-normalizes an admin-typed backfill start for the adapter's
 * `z.string().datetime()`.
 *
 * Strict on purpose: `Date.parse` rolls `2026-02-30` forward to March 2 instead
 * of failing, which would silently backfill from a date nobody chose.
 *
 * Empty is not an error — the field is optional — so it yields undefined, while
 * anything rejected yields null for the caller to turn into a toast.
 */
function normalizeStartingAt(raw: string): string | null | undefined {
  if (!raw) return undefined;

  const match = STARTING_AT.exec(raw);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isRealCalendarDate(year, month, day)) return null;

  try {
    const instant = Temporal.Instant.from(
      /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : raw,
    );
    return instant.toString({ fractionalSecondDigits: 3 });
  } catch {
    return null;
  }
}
