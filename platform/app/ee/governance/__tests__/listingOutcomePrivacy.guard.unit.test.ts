// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The two listing-outcome rules whose violation is a privacy incident rather
 * than a bug, made falsifiable.
 *
 * Everything else in this feature is held up by a test. These two were held up
 * by comments, which is backwards -- they are the only two where being wrong
 * discloses something about a real person.
 *
 * RULE 1. `LastPeopleWithheldCount` counts the people this deployment erased
 * and does not hold. Where it may go is decided by WHO CAN READ THE SINK, not
 * by whether the sink keeps one figure or a history. Inside our boundary it may
 * be kept per run and deliberately is -- the event log and the run status row
 * both hold it, because an operator entitled to the number needs to see it
 * move. It must not reach a sink whose readers are wider than the set we
 * granted this tenant's data to, telemetry export above all, where even a
 * single current value is already too far. What the PRODUCT may draw with it
 * is separately limited to a current figure: no trend line, no history drawer,
 * never beside a per-person list.
 *
 * RULE 2. `LastAgentsListingStatus` and `LastPeopleListingStatus` hold an HTTP
 * status for an operator reading a support ticket. They are never rendered to
 * a customer. A span is an operator surface, so a status there is fine; the
 * customer-facing trees are the boundary that matters for these two.
 *
 * WHAT THIS FILE CAN AND CANNOT PROVE, stated plainly so nobody retires the
 * question by pointing at a green run:
 *
 * It proves the two status NAMES do not appear in the customer-facing trees,
 * and that no command's span attributes carry the withheld count. It cannot
 * prove a rename: someone who copies a value into a field called `httpStatus`
 * defeats the name scan, and only review catches that. It is a guard against
 * the likely mistake, not a proof of the rule.
 *
 * TWO LESSONS FROM WRITING IT, both paid for:
 *
 * The people-listed SPAN carried the withheld count in shipped code while
 * every comment in the feature said it must not. Prose in four files stopped
 * nothing; the guard below would have. If you add another sink outside our
 * boundary -- a metric, a webhook, a CSV export, a log line -- it needs its own
 * block here, because neither block below will see it.
 *
 * And the first version of the span check read a property that did not exist,
 * defaulted to an empty object, and passed against the very leak it was written
 * for. A guard that cannot fail is worse than no guard, because it answers the
 * question for everyone who comes after. Mutate anything you add here and watch
 * it go red before you believe it.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as pipelineCommands from "@ee/event-sourcing/pipelines/ingestion-pull-processing/commands";
import type { IngestionPullRunStatusData } from "@ee/event-sourcing/pipelines/ingestion-pull-processing/projections/ingestionPullRunStatus.foldProjection";
import { buildIngestionSourceMirror } from "@ee/governance/services/pullers/repositories/ingestionSourceMirror";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** `platform/app/` -- parent of both `src/` and `ee/`. */
const APP_ROOT = path.resolve(HERE, "../../..");

/**
 * Never customer-visible under any circumstance, so the scan can be absolute.
 *
 * The withheld count is deliberately NOT in this list. It has a legitimate
 * customer rendering -- one current figure -- and banning the name outright
 * would forbid the allowed use, which is how a guard in the wrong place
 * retires the question it was meant to keep open. Its rule is guarded below
 * by shape and storage instead.
 */
const OPERATOR_ONLY_FIELDS = [
  "LastAgentsListingStatus",
  "LastPeopleListingStatus",
] as const;

/**
 * Everything a customer can reach for the agents and sources screens: the
 * rendered components, the pages, the routers that feed them, and the
 * server-side row builders whose shapes become the response.
 *
 * `ee/governance/services/pullers/` is deliberately absent. That tree is where
 * these fields legitimately live -- the projection writes them, the repository
 * stores them, an operator reads them. The boundary this guard draws is
 * between there and here.
 */
const CUSTOMER_TREES = [
  "src/components/governance",
  "src/pages/governance",
  "ee/governance/routers",
  "ee/governance/dashboard",
  "ee/governance/services/logic",
];

/** This file names the banned fields in order to ban them. */
const EXEMPT = [path.relative(APP_ROOT, fileURLToPath(import.meta.url))];

const isSource = (f: string) => /\.(?:mts|cts|tsx?)$/.test(f);

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (isSource(full)) out.push(full);
  }
  return out;
};

/** Every `file:line` in the customer trees that names `field`. */
function occurrencesOf(field: string): string[] {
  const hits: string[] = [];
  for (const tree of CUSTOMER_TREES) {
    const root = path.join(APP_ROOT, tree);
    if (!fs.existsSync(root)) continue;
    for (const file of walk(root)) {
      const relative = path.relative(APP_ROOT, file);
      if (EXEMPT.includes(relative)) continue;
      const lines = fs.readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (line.includes(field)) hits.push(`${relative}:${i + 1}`);
      });
    }
  }
  return hits;
}

/** Every scalar reachable in `value`, flattened, for a value-leak scan. */
function scalarsOf(value: unknown, out: unknown[] = []): unknown[] {
  if (value === null || value === undefined) return out;
  if (Array.isArray(value)) {
    for (const item of value) scalarsOf(item, out);
    return out;
  }
  if (value instanceof Date) {
    out.push(value.getTime());
    return out;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value)) scalarsOf(item, out);
    return out;
  }
  out.push(value);
  return out;
}

/**
 * A state carrying sentinels in the three sensitive columns.
 *
 * The sentinels are values nothing else in the pipeline produces, so a match
 * downstream is a leak and not a coincidence: 418 and 451 are statuses this
 * product never returns, and 90_210 is not a plausible headcount.
 */
const AGENTS_STATUS_SENTINEL = 418;
const PEOPLE_STATUS_SENTINEL = 451;
const WITHHELD_SENTINEL = 90_210;

function stateWithSentinels(): IngestionPullRunStatusData {
  return {
    SourceId: "source-1",
    Enabled: true,
    Cron: null,
    CreatedAt: 1_000,
    UpdatedAt: 1_000,
    LastEventOccurredAt: 1_200,
    Cursor: "cursor-A",
    ConsecutiveErrors: 0,
    LastSuccessAt: 1_000,
    LastRunAt: 1_000,
    LastRunOutcome: "completed",
    LastRunEventCount: 3,
    LastRunError: null,
    LastRunErrorCode: null,
    LastRunScheduledFor: 900,
    LastAgentsListingAt: 1_100,
    LastAgentsListingOutcome: "refused",
    LastAgentsListingCount: null,
    LastAgentsListingReason: "listing_failed",
    LastAgentsListingStatus: AGENTS_STATUS_SENTINEL,
    LastPeopleListingAt: 1_200,
    LastPeopleListingOutcome: "refused",
    LastPeopleDirectoryCount: null,
    LastPeopleWithheldCount: WITHHELD_SENTINEL,
    LastPeopleListingReason: "listing_failed",
    LastPeopleListingStatus: PEOPLE_STATUS_SENTINEL,
  };
}

describe("given the listing outcome columns exist", () => {
  describe("when a customer-facing surface is built", () => {
    /** @scenario "An operator-only HTTP status never reaches a customer" */
    it.each(
      OPERATOR_ONLY_FIELDS,
    )("does not name %s anywhere a customer can reach", (field) => {
      const hits = occurrencesOf(field);

      expect(
        hits,
        [
          `${field} is named in a customer-facing file: ${hits.join(", ")}.`,
          "",
          "This column holds a raw HTTP status from a provider, kept so an",
          "operator reading a support ticket can tell a 403 from a 500. It is",
          "not a customer-facing fact: a tenant admin shown '403' learns that",
          "some credential somewhere was refused, which is not actionable by",
          "them and is a detail about our integration rather than about their",
          "data. Show them the OUTCOME (refused) and a sentence they can act",
          "on; leave the status in the operator's view.",
          "",
          "If you need to branch on it server-side to CHOOSE that sentence,",
          "do the branching in ee/governance/services/pullers/ and let only",
          "the resulting words cross into these trees.",
        ].join("\n"),
      ).toEqual([]);
    });

    /** @scenario "The mirror carries no sensitive value onto a customer row" */
    it("keeps all three sensitive values out of the ingestion source mirror", () => {
      const mirror = buildIngestionSourceMirror({
        state: stateWithSentinels(),
      });
      const leaked = scalarsOf(mirror);

      // `IngestionSource` rows ARE customer-adjacent -- the sources screen
      // reads them. The mirror is the one function where the sensitive columns
      // sit in scope beside a customer-bound output, so it is the only place a
      // value could cross by accident rather than by decision.
      //
      // One assertion covering all three rather than three assertions: the
      // message below is the whole point of this guard, and a per-sentinel
      // `expect` would print it only for whichever sentinel happens to be
      // checked first.
      const escaped = [
        [AGENTS_STATUS_SENTINEL, "LastAgentsListingStatus"],
        [PEOPLE_STATUS_SENTINEL, "LastPeopleListingStatus"],
        [WITHHELD_SENTINEL, "LastPeopleWithheldCount"],
      ] as const;

      expect(
        escaped
          .filter(([sentinel]) => leaked.includes(sentinel))
          .map(([, field]) => field),
        [
          "A value from a sensitive column reached the ingestion source mirror.",
          "",
          "The mirror writes onto IngestionSource, which the sources screen",
          "renders. A value that arrives here is one field addition away from a",
          "customer's eyes, and it arrives without anyone deciding it should.",
          "",
          "Two of these are operator-only HTTP statuses. The third is the count",
          "of people this deployment does not hold: safe as one current figure,",
          "never as a series, and putting it on a row that other code copies,",
          "caches and exports is how it quietly becomes a series.",
          "",
          `Mirror was: ${JSON.stringify(mirror)}`,
        ].join("\n"),
      ).toEqual([]);

      // And the names, so a future mirror field cannot carry one under an
      // alias. `status` alone is a legitimate mirror key -- it holds "active"
      // -- so this looks for the compound names only.
      const keys = Object.keys(mirror).join(",").toLowerCase();
      expect(keys).not.toContain("listingstatus");
      expect(keys).not.toContain("withheld");
    });
  });

  describe("when a command exports a telemetry span", () => {
    /**
     * @scenario "The erasure count never rides a span"
     *
     * This block exists because this exact leak SHIPPED. The people-listed
     * command carried `payload.withheld_person_count`, and a person reading the
     * file caught it -- the rule was written down in four places and enforced
     * in none of them.
     *
     * THE TEST IS THE REACH, NOT THE SHAPE. Our own stores may keep this count
     * per run and deliberately do: the event log and the run status row sit
     * inside our boundary, under our retention, readable only by those we
     * granted this tenant's data to, and an operator entitled to it needs to
     * see the count move. A span is different in kind -- it leaves over a
     * plain exporter to a backend with its own retention and a reader set of
     * every engineer with a dashboard login. So even a single current figure
     * on a span is already too far, and no amount of aggregating makes it
     * acceptable.
     *
     * Scoped to the withheld count. The two HTTP statuses are operator-only,
     * and a span is an operator surface, so a status there is allowed; it is
     * the reach past our boundary that rules this one number out.
     *
     * Every command in the pipeline is checked rather than the four listing
     * ones, so a count copied onto an unrelated span is caught too.
     */
    it("carries no withheld count on any command's span", () => {
      const listingData = {
        sourceId: "source-1",
        requestId: "request-1",
        requestedAt: 1_000,
        agentCount: 7,
        directoryPersonCount: 30,
        withheldPersonCount: WITHHELD_SENTINEL,
        reason: "listing_failed",
        status: PEOPLE_STATUS_SENTINEL,
      };

      // Every exported command that defines span attributes, discovered from
      // the module rather than listed here: a new command gets this guard
      // without anyone remembering to add it.
      //
      // The real attribute functions are EXECUTED. Reading the source for the
      // string would pass just as happily against a dead code path, and it was
      // running one of these that proved the original leak was live rather
      // than vestigial.
      const commands = Object.entries(pipelineCommands).filter(
        ([, value]) =>
          typeof (value as { getSpanAttributes?: unknown })
            ?.getSpanAttributes === "function",
      ) as [string, { getSpanAttributes?: (data: never) => unknown }][];

      expect(
        commands.length,
        "No command in the pipeline exposes span attributes. Either the module moved or the accessor was renamed; either way this guard is now scanning nothing.",
      ).toBeGreaterThan(0);

      // Note the accessor name. An earlier draft of this test reached for a
      // property called `spanAttributes`, got `undefined`, defaulted to `{}`
      // and passed against a span that really was carrying the count. The
      // optional chaining turned the guard into decoration and nothing said
      // so, which is why the filter above asserts a non-empty set rather than
      // trusting that it found something.
      const offenders: string[] = [];
      for (const [name, command] of commands) {
        let attributes: unknown;
        try {
          attributes = command.getSpanAttributes?.(listingData as never);
        } catch {
          // A command whose attribute function cannot read this payload is not
          // one that carries our field; only the people-listed data shape has
          // a withheld count at all.
          continue;
        }
        if (typeof attributes !== "object" || attributes === null) continue;

        for (const [key, value] of Object.entries(attributes)) {
          if (value === WITHHELD_SENTINEL || /withheld/i.test(key)) {
            offenders.push(`${name}: ${key}=${String(value)}`);
          }
        }
      }

      expect(
        offenders,
        [
          "A command puts the withheld people count on a telemetry span.",
          "",
          `Offending attributes: ${offenders.join(", ")}.`,
          "",
          "That number counts the people this deployment erased and does not",
          "hold. A span leaves over a plain exporter to a backend with its own",
          "retention and a reader set of every engineer with a dashboard login",
          "-- readers far wider than the set we granted this tenant's data to.",
          "",
          "THE TEST IS THE REACH, NOT THE SHAPE. Keeping it per run is fine",
          "inside our boundary and we do it deliberately: the event log and the",
          "run status row both hold it, because an operator entitled to it needs",
          "to see the count move. Reducing it to a single current figure does",
          "NOT make a span acceptable -- crossing the boundary is the problem,",
          "so even one value there is already too far.",
          "",
          "'No names on spans' is not a sufficient test for this field. The",
          "COUNT is the sensitive fact, because it counts erasures: N to N+1 at",
          "a known moment says an erasure happened then, and on a small tenant",
          "that identifies the person as surely as a name would.",
          "",
          "The directory count may stay -- it is what the provider named, which",
          "our erasure does not move. Adding any new sink: ask who can read it.",
        ].join("\n"),
      ).toEqual([]);
    });
  });

  /**
   * TWO GUARDS THAT ARE DELIBERATELY ABSENT. Both are written down because an
   * absent guard is invisible, and the next reader deserves to know it was a
   * decision rather than an oversight.
   *
   * FIRST: there is no "stored only once" check, and an earlier draft of this
   * file had one.
   *
   * That draft counted `LastPeopleWithheldCount` declarations in
   * `schema.prisma`, insisted on exactly one, and argued in its failure
   * message that a single overwritten column cannot express a series. It would
   * have failed the day anyone added a legitimate internal per-run store --
   * and this feature already HAS one, on purpose: the event log keeps the
   * count for every run, because an operator entitled to the number needs to
   * see it move.
   *
   * So that guard did not encode the rule; it encoded a misreading of it, and
   * it would have blocked correct work while teaching the next reader the
   * wrong test. The rule is about REACH -- who can read the sink -- and the
   * span guard above is where reach is actually checkable.
   *
   * If you are adding a sink for this count, the question is not "is it one
   * value or a history". It is "who can read it". Inside our boundary, under
   * our retention, readable only by those we granted this tenant's data to:
   * fine. Anything wider: not, at any shape or resolution.
   *
   * SECOND: the other half of rule 1 -- that the withheld count is a subset,
   * so a visible-people figure SUBTRACTS it rather than adding it -- has no
   * guard either.
   *
   * Nothing computes that figure yet. A test asserting `30 - 4 === 26` against
   * inline constants would exercise arithmetic rather than this codebase, pass
   * forever, and read on the next audit as though the subset rule were
   * covered. That is worse than the gap it papers over.
   *
   * The fold's own tests already assert both counts survive a listing with the
   * subset relation intact. When something finally renders a visible-people
   * figure, the guard belongs beside it, asserting that function returns the
   * directory count MINUS the withheld one -- 34 for a tenant of 30 people is
   * a fabricated headcount that overstates our reach into their directory, and
   * it is the error a reader cannot detect.
   */
});
