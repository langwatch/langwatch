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
 * a customer. A span is an operator surface, so a status there is fine; what
 * matters for these two is that the column stays where it is produced.
 *
 * WHAT THIS FILE CAN AND CANNOT PROVE, stated plainly so nobody retires the
 * question by pointing at a green run:
 *
 * It proves the two status NAMES appear in exactly one authored file, that the
 * one read path serving a customer screen narrows to two columns before the
 * status is in scope, and that every ingestion-pull command's span attributes
 * are the exact names AND numbers declared. It cannot prove a rename in a file
 * it does not reach: someone who copies a status into a field called
 * `httpStatus` inside an unrelated service defeats a name scan, and only
 * review catches that. It is a guard against the likely mistake, not a proof
 * of the rule.
 *
 * THREE LESSONS FROM WRITING IT, all paid for:
 *
 * The people-listed SPAN carried the withheld count in shipped code while
 * every comment in the feature said it must not. Prose in four files stopped
 * nothing; the guard below would have. If you add another sink outside our
 * boundary -- a metric, a webhook, a CSV export, a log line -- it needs its own
 * block here, because no block below will see it.
 *
 * The first version of the span check read a property that did not exist,
 * defaulted to an empty object, and passed against the very leak it was written
 * for. A guard that cannot fail is worse than no guard, because it answers the
 * question for everyone who comes after. Mutate anything you add here and watch
 * it go red before you believe it.
 *
 * And the first version of the NAME check listed the trees it considered
 * customer-facing, which quietly made every other tree legal. Three separate
 * holes came out of that one decision: `ee/governance/services/pullers/` holds
 * the narrowing function whose return type is the customer's row shape, and
 * widening that type by one column shipped the status to a screen with the
 * guard green; `ee/governance/services/` at the top level, where the service
 * that feeds the agents router lives, was scanned by nothing at all; and the
 * router looked clean only because an unscanned file had cleaned it. An
 * enumerated safe-list is the wrong shape for this question -- it grants
 * everything it forgot to name. The scan below is inverted: the whole app is
 * in scope and the homes are declared.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as pipelineCommands from "@ee/event-sourcing/pipelines/ingestion-pull-processing/commands";
import type { IngestionPullRunStatusData } from "@ee/event-sourcing/pipelines/ingestion-pull-processing/projections/ingestionPullRunStatus.foldProjection";
import { agentsListingOutcome } from "@ee/governance/services/pullers/agentsListingOutcome";
import { PrismaIngestionPullRunProjectionRepository } from "@ee/governance/services/pullers/repositories/ingestion-pull-run-projection.prisma.repository";
import { buildIngestionSourceMirror } from "@ee/governance/services/pullers/repositories/ingestionSourceMirror";
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";

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

/** Everything this application is built from. Both roots, no exceptions. */
const SCAN_ROOTS = ["ee", "src"];

/**
 * Files that may name an operator-only column, and the ONE role that earns it.
 *
 * A CLOSED SET, asserted with equality rather than containment, for the same
 * reason `DECLARED_SPAN_ATTRIBUTES` below is closed: the risk direction is ADD,
 * and a rule phrased as "not in these places" passes forever while the column
 * spreads into places nobody thought to name. Equality also fails when an entry
 * goes STALE, so the list cannot rot into a permission slip for code that no
 * longer exists.
 *
 * WHAT MAKES AN ENTRY LEGITIMATE, because this is the part that decays if it is
 * left implicit. A file belongs here when it PRODUCES the column -- declares it
 * or writes it -- and nothing else does. It does not belong here because the
 * guard complained about it. Adding a line to make a red run green, without
 * being able to finish the sentence "this file may hold a raw provider status
 * because ___, and its readers are ___", is how this file stops being a guard
 * and starts being a record of what the code happens to do.
 *
 * The count today is why one entry is enough, and it is worth knowing: across
 * 5,500 authored source files under `ee/` and `src/`, exactly one names either
 * column. There is no operator READ path in the codebase at all -- the only way
 * to the number is a direct query against the run status table -- and the one
 * read that serves a customer screen selects two columns that are not these
 * (`findAgentsListings`, guarded below). So this is not a list of the files the
 * status reaches. It is the single place it is born.
 */
const DECLARED_HOMES: Record<(typeof OPERATOR_ONLY_FIELDS)[number], string[]> =
  {
    // Declares both columns on the projection state and writes them in the
    // fold. This is the producer: the event carries the provider's status and
    // the fold is what turns it into a stored column. Its readers are the
    // projection store and an operator querying the table directly.
    LastAgentsListingStatus: [
      "ee/event-sourcing/pipelines/ingestion-pull-processing/projections/ingestionPullRunStatus.foldProjection.ts",
    ],
    LastPeopleListingStatus: [
      "ee/event-sourcing/pipelines/ingestion-pull-processing/projections/ingestionPullRunStatus.foldProjection.ts",
    ],
  };

/**
 * Two structural exclusions, neither of them a judgement about a file.
 *
 * TESTS. A test file is not a deployed surface: it renders to nobody, ships to
 * nobody, and naming a column in a fixture discloses nothing. Including them
 * would fill the declared set above with fixtures that change whenever somebody
 * adds a case, and a list that churns for reasons unrelated to privacy is a
 * list people stop reading. The rule is about reach, and a test has none.
 *
 * GENERATED PRISMA CLIENT. `src/generated/prisma/` is written by
 * `prisma:generate:typescript` from `schema.prisma`, where these columns are
 * declared. It is that declaration compiled, not a use of it, and it is absent
 * from a fresh checkout and present in CI -- so scanning it would make this
 * guard's verdict depend on whether a build step had run.
 */
const isSource = (f: string) => /\.(?:mts|cts|tsx?)$/.test(f);
const isTest = (relative: string) =>
  relative.includes(`${path.sep}__tests__${path.sep}`) ||
  /\.test\.tsx?$/.test(relative);
const isGenerated = (relative: string) =>
  relative.startsWith(path.join("src", "generated") + path.sep);

/** This file names the banned fields in order to ban them. */
const EXEMPT = [path.relative(APP_ROOT, fileURLToPath(import.meta.url))];

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (isSource(full)) out.push(full);
  }
  return out;
};

/** Every authored, shipped source file in the application. */
function scannedFiles(): string[] {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) {
    const abs = path.join(APP_ROOT, root);
    if (fs.existsSync(abs)) walk(abs, files);
  }
  return files
    .map((file) => path.relative(APP_ROOT, file))
    .filter(
      (relative) =>
        !isTest(relative) &&
        !isGenerated(relative) &&
        !EXEMPT.includes(relative),
    )
    .sort();
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

/**
 * Every span attribute the ingestion-pull commands are allowed to export,
 * command by command, as the exact name AND the exact value each puts there
 * for {@link SPAN_PAYLOAD}.
 *
 * NAMES ALONE ARE NOT ENOUGH, and this used to assert only the key set. The
 * withheld count can ride a span under a key that is already declared: change
 * `payload.directory_person_count` to `directoryPersonCount - withheldPersonCount`
 * and the key set is byte-identical while the number now moves by exactly the
 * erasure count on every run. That is the same disclosure the key would have
 * been -- a figure stepping at a known moment because somebody was erased --
 * wearing an approved name. Pinning the values is what sees it.
 *
 * This is a closed set on purpose. The commands themselves are enumerated
 * from the module's exports, so a new command appears here as a failure the
 * moment it exists, and stays failing until somebody writes down what it puts
 * on a span. That pause is the feature: it is the point at which to ask who
 * can read the sink.
 *
 * Adding a line here is a decision about reach, not a formality. Nothing goes
 * on a span that the whole engineering org should not be able to read.
 */
const DECLARED_SPAN_ATTRIBUTES: Record<
  string,
  Record<string, string | number>
> = {
  ConfigureIngestionPullCommand: { "payload.source_id": "source-1" },
  DisableIngestionPullCommand: { "payload.source_id": "source-1" },
  RecordIngestionPullRunCompletedCommand: {
    "payload.event_count": 3,
    "payload.run_id": "run-1",
    "payload.source_id": "source-1",
  },
  RecordIngestionPullRunFailedCommand: {
    "payload.run_id": "run-1",
    "payload.source_id": "source-1",
  },
  RequestIngestionPullAgentsListingCommand: {
    "payload.request_id": "request-1",
    "payload.source_id": "source-1",
  },
  RecordIngestionPullAgentsListedCommand: {
    "payload.agent_count": 7,
    "payload.request_id": "request-1",
    "payload.source_id": "source-1",
  },
  RecordIngestionPullAgentsListingRefusedCommand: {
    "payload.reason": "listing_failed",
    "payload.request_id": "request-1",
    "payload.source_id": "source-1",
  },
  RequestIngestionPullPeopleListingCommand: {
    "payload.request_id": "request-1",
    "payload.source_id": "source-1",
  },
  // The directory count is here and the withheld count is deliberately not.
  // The provider named the directory figure and our erasure does not move it;
  // the withheld figure counts erasures and was live on this span until
  // 6eed79100a removed it. The value below is the payload's directory count
  // UNTOUCHED -- 30, not 30 minus anything -- and that is the assertion: a
  // figure the erasure count moves is the erasure count, whatever it is called.
  RecordIngestionPullPeopleListedCommand: {
    "payload.directory_person_count": 30,
    "payload.request_id": "request-1",
    "payload.source_id": "source-1",
  },
  RecordIngestionPullPeopleListingRefusedCommand: {
    "payload.reason": "listing_failed",
    "payload.request_id": "request-1",
    "payload.source_id": "source-1",
  },
};

/**
 * One payload populated for every command in the module.
 *
 * The withheld count and the HTTP status are sentinels, so a span carrying
 * either is recognisable and not a coincidence. The directory count is a plain
 * 30 rather than a sentinel BECAUSE it is allowed through: the declared value
 * above is that same 30, so any arithmetic applied to it on the way to the span
 * changes the number and fails.
 */
const SPAN_PAYLOAD = {
  sourceId: "source-1",
  runId: "run-1",
  requestId: "request-1",
  requestedAt: 1_000,
  scheduledFor: 1_000,
  occurredAt: 1_000,
  eventCount: 3,
  agentCount: 7,
  directoryPersonCount: 30,
  withheldPersonCount: WITHHELD_SENTINEL,
  reason: "listing_failed",
  status: PEOPLE_STATUS_SENTINEL,
  cron: "* * * * *",
  cursor: "cursor-A",
  error: "boom",
  errorCode: "code",
};

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
  describe("when the application is scanned for the operator-only columns", () => {
    /**
     * THE INSTRUMENT, CHECKED BEFORE ITS VERDICT IS BELIEVED.
     *
     * Every assertion below reads "the set of files naming this column is
     * exactly the declared set", and the declared set is one file. A scan that
     * had silently stopped walking -- a moved root, a regex that stopped
     * matching `.tsx`, an exclusion that swallowed everything -- would return
     * an empty set for a column that is named nowhere, which is not the same
     * verdict and looks identical.
     *
     * So the population is asserted first. The floor is deliberately far below
     * today's 5,500 and far above zero: it is here to catch a collapse, not to
     * be a file count somebody has to maintain.
     */
    /** @scenario "The scan reaches the whole application" */
    it("walks thousands of authored files before reporting anything", () => {
      const files = scannedFiles();

      expect(
        files.length,
        "The name scan walked almost nothing. Its verdict below is 'this column is named in no unexpected file', which is exactly what an empty walk returns, so nothing it says can be believed until this passes. Check SCAN_ROOTS against the directory layout and isSource against the extensions in use.",
      ).toBeGreaterThan(1_000);

      // And the walk really reaches the far corners rather than one subtree:
      // the deepest declared home, plus a file in the other root.
      expect(files).toContain(DECLARED_HOMES.LastAgentsListingStatus[0]);
      expect(
        files.some((file) => file.startsWith(`src${path.sep}`)),
        "The walk found nothing under src/, so half the application is unscanned.",
      ).toBe(true);
    });

    /** @scenario "An operator-only HTTP status never reaches a customer" */
    it.each(
      OPERATOR_ONLY_FIELDS,
    )("names %s only where it is produced", (field) => {
      const naming = scannedFiles().filter((relative) =>
        fs.readFileSync(path.join(APP_ROOT, relative), "utf8").includes(field),
      );

      expect(
        naming,
        [
          `${field} is named in a file that is not one of its declared homes.`,
          "",
          "This column holds a raw HTTP status from a provider, kept so an",
          "operator reading a support ticket can tell a 403 from a 500. It is",
          "not a customer-facing fact: a tenant admin shown '403' learns that",
          "some credential somewhere was refused, which is not actionable by",
          "them and is a detail about our integration rather than about their",
          "data. Show them the OUTCOME (refused) and a sentence they can act",
          "on; leave the status in the operator's view.",
          "",
          "THE SCAN IS THE WHOLE APPLICATION, on purpose. An earlier version",
          "listed the trees it considered customer-facing, which made every",
          "tree it forgot legal -- and the three files that mattered most were",
          "all in trees it forgot. A projection type widened by one column, a",
          "service above the listed trees, and a router that looked clean",
          "because an unscanned file had cleaned it.",
          "",
          "IF YOUR FILE IS A PRODUCER -- it declares the column or writes it --",
          "add it to DECLARED_HOMES above with a sentence naming its readers.",
          "If you cannot write that sentence, that is the answer.",
          "",
          "IF YOU NEED TO BRANCH ON THE STATUS to choose what a screen says,",
          "do it inside a declared home and let only the resulting words out.",
          "`agentsListingOutcome` is the worked example: it reads the outcome",
          "and the reason, never the status, and returns two words.",
        ].join("\n"),
      ).toEqual(DECLARED_HOMES[field]);
    });
  });

  describe("when a customer-facing surface is built", () => {
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
          "of people this deployment does not hold. THE TEST IS THE REACH, NOT",
          "THE SHAPE: reducing it to a single current figure does not make this",
          "row an acceptable home for it. Our own stores may keep it per run and",
          "deliberately do -- the event log and the run status row both hold it",
          "-- because their readers are the ones we granted this tenant's data",
          "to. This row is copied, cached and exported outward, so the readers",
          "are no longer that set. That is what rules it out here, at any shape.",
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

    /**
     * THE ONE READ PATH THAT SERVES A CUSTOMER SCREEN, checked by VALUE rather
     * than by name -- because the name scan above cannot see a rename, and this
     * is the single seam where a rename would matter.
     *
     * `governanceAgents.syncSources` calls `listableSourcesWithLastListing`,
     * which calls `findAgentsListings`, whose result is narrowed by
     * `agentsListingOutcome` into two words and handed to the client. Every
     * column of the run status row is available to that query; two of them are
     * chosen. Nothing in the type system says the other twenty-four may not
     * join them, and `LastAgentsListingStatus: number | null` is as easy to
     * carry under the key `httpStatus` as under its own.
     *
     * So this drives the real repository against a stub row that carries the
     * sentinel status, and asserts three things a rename cannot survive: the
     * SELECT names exactly the two safe columns, the mapped row has exactly
     * those two keys, and no sentinel reaches the words the screen renders.
     *
     * The select assertion is the one that earns its place twice. Even if the
     * mapper kept picking two fields, widening the select would put the raw
     * status into the process that serves the page, which is the state the
     * repository's own comment ("THE SELECT IS THE POINT") exists to prevent.
     */
    /** @scenario "The read that feeds the agents screen stays two columns wide" */
    it("selects and returns only the two safe columns for the agents screen", async () => {
      const selects: unknown[] = [];
      const prisma = {
        ingestionPullRunProjection: {
          findMany: async ({ select }: { select: unknown }) => {
            selects.push(select);
            // Everything the row could offer, including the sentinel status
            // under its own name and under a plausible alias. A repository that
            // reaches for either is caught by the shape assertion below.
            return [
              {
                sourceId: "source-1",
                LastAgentsListingOutcome: "refused",
                LastAgentsListingReason: "unauthorized",
                LastAgentsListingStatus: AGENTS_STATUS_SENTINEL,
                LastAgentsListingCount: null,
                LastPeopleListingStatus: PEOPLE_STATUS_SENTINEL,
                LastPeopleWithheldCount: WITHHELD_SENTINEL,
              },
            ];
          },
        },
      } as unknown as PrismaClient;

      const listings = await new PrismaIngestionPullRunProjectionRepository(
        prisma,
      ).findAgentsListings({ sourceIds: ["source-1"], projectId: "project-1" });

      const explain = (what: string) =>
        [
          what,
          "",
          "This is the read behind governanceAgents.syncSources: the agents",
          "screen asks how the last listing ended, and this query is where the",
          "run status row is opened. Every column is in reach here and two are",
          "chosen, which is the cheapest possible form of the rule -- a value",
          "that was never selected cannot be forwarded by a later edit.",
          "",
          "A NAME SCAN CANNOT SEE WHAT THIS SEES. Carrying the status out as",
          "`httpStatus`, or as a number on a wider summary type, leaves the",
          "column name behind and reaches the client all the same. That is why",
          "this asserts the SELECT and the SHAPE rather than the spelling.",
          "",
          "If a screen needs to say something new about a refusal, decide it",
          "server-side from the outcome and the reason -- both already selected",
          "-- and return words. Do not widen this to carry the raw status out.",
        ].join("\n");

      expect(
        selects.map((select) => Object.keys(select as object).sort()),
        explain(
          "The agents-listing query selected columns beyond the two safe ones.",
        ),
      ).toEqual([
        ["LastAgentsListingOutcome", "LastAgentsListingReason", "sourceId"],
      ]);

      const summary = listings.get("source-1");
      expect(
        Object.keys(summary ?? {}).sort(),
        explain(
          "The agents-listing summary carries a field beyond the two safe ones.",
        ),
      ).toEqual(["LastAgentsListingOutcome", "LastAgentsListingReason"]);

      // And the value, through the narrowing function, to the words the screen
      // actually renders.
      const rendered = agentsListingOutcome(summary);
      expect(
        scalarsOf(rendered).filter((value) =>
          [
            AGENTS_STATUS_SENTINEL,
            PEOPLE_STATUS_SENTINEL,
            WITHHELD_SENTINEL,
          ].includes(value as number),
        ),
        explain("A sensitive value reached what the agents screen renders."),
      ).toEqual([]);
    });
  });

  describe("when an ingestion-pull command exports a telemetry span", () => {
    /**
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
     * WHY THIS ASSERTS AN EXACT MAP RATHER THAN AN ABSENCE, OR A KEY SET. The
     * risk direction is ADD. A guard that says "the forbidden keys are not
     * present" passes forever while new attributes accumulate beside it,
     * because the absence of the names we thought of is not the absence of the
     * names we did not. So the keys are closed.
     *
     * But closing the keys alone is not enough either, and an earlier version
     * of this test asserted only keys and said so explicitly. Change
     * `payload.directory_person_count` to `directoryPersonCount` minus
     * `withheldPersonCount` and the key set does not move by a byte, while the
     * exported number now steps by exactly the erasure count. The disclosure is
     * identical to the one the deleted key made -- a figure that moves when
     * somebody is erased -- and a key-set guard is blind to it by construction.
     * So the values are pinned too, against a fixed payload.
     *
     * WHAT THIS DOES NOT COVER, said plainly rather than implied by the title:
     * the ingestion-pull pipeline and nothing else. Eighteen-odd commands in
     * other pipelines expose span attributes and are not enumerated here. That
     * is the honest scope -- this file guards two governance columns, not the
     * whole product's telemetry -- and the block is named for the pipeline so
     * the next reader does not mistake a green run for a claim about all of
     * them. A pipeline that starts carrying an erasure count needs its own
     * block, in its own feature.
     *
     * The commands are enumerated from the module's exports, never a
     * hand-written array: a hand-written list means the fifth command, added
     * next month with a leaky attribute, is simply not covered and the suite
     * stays green by omission -- today's failure wearing a test's clothes.
     */
    /** @scenario "The erasure count never rides a span" */
    it("puts exactly the declared attributes and values on every command's span", () => {
      // Every exported command that defines span attributes, discovered from
      // the module. The real attribute functions are EXECUTED: reading the
      // source for a string would pass just as happily against a dead code
      // path, and it was running one of these that proved the original leak
      // was live rather than vestigial.
      const commands = Object.entries(pipelineCommands).filter(
        ([, value]) =>
          typeof (value as { getSpanAttributes?: unknown })
            ?.getSpanAttributes === "function",
      ) as [string, { getSpanAttributes?: (data: never) => unknown }][];

      expect(
        commands.length,
        "No command in the pipeline exposes span attributes. Either the module moved or the accessor was renamed -- note that the source writes `spanAttributes` while the built command exposes `getSpanAttributes` -- and either way this guard is now scanning nothing.",
      ).toBe(Object.keys(DECLARED_SPAN_ATTRIBUTES).length);

      // Note the accessor name. An earlier draft of this test reached for a
      // property called `spanAttributes`, got `undefined`, defaulted to `{}`
      // and passed against a span that really was carrying the count. The
      // optional chaining turned the guard into decoration and nothing said
      // so, which is why the count above is asserted rather than assumed.
      const actual: Record<string, Record<string, unknown>> = {};
      for (const [name, command] of commands) {
        const attributes = (command.getSpanAttributes?.(
          SPAN_PAYLOAD as never,
        ) ?? {}) as Record<string, unknown>;
        actual[name] = Object.fromEntries(
          Object.entries(attributes).sort(([a], [b]) => a.localeCompare(b)),
        );
      }

      expect(
        actual,
        [
          "A command's span attributes are not the declared set.",
          "",
          "If a key was ADDED: a span leaves over a plain exporter to a backend",
          "with its own retention, readable by every engineer with a dashboard",
          "login -- far wider than the set we granted this tenant's data to.",
          "Whatever you just put there is now readable by all of them.",
          "",
          "IF A VALUE CHANGED AND THE KEY DID NOT, read this twice. That is the",
          "case this assertion was widened to catch, and it does not look like a",
          "leak in a diff. `payload.directory_person_count` must be the payload's",
          "directory count untouched. Subtract the withheld count from it and the",
          "exported figure steps by exactly one every time somebody is erased --",
          "which is the erasure count, exported, under an approved name. Any",
          "arithmetic that makes a span attribute move with an erasure is the",
          "thing this rule forbids, whatever the key is called.",
          "",
          "`payload.withheld_person_count` is the one that has already escaped",
          "this way, and it must never come back. That number counts the people",
          "this deployment erased and does not hold. THE TEST IS THE REACH, NOT",
          "THE SHAPE: keeping it per run inside our boundary is fine and we do",
          "it deliberately -- the event log and the run status row both hold it,",
          "because an operator entitled to it needs to see the count move.",
          "Reducing it to a single current figure does NOT make a span",
          "acceptable; crossing the boundary is the problem, so even one value",
          "there is already too far. N to N+1 at a known moment says an erasure",
          "happened then, and on a small tenant that identifies the person as",
          "surely as a name would. `payload.directory_person_count` is fine and",
          "stays -- it is what the provider named, which our erasure does not",
          "move.",
          "",
          "If a whole COMMAND is unlisted: say what it puts on a span by adding",
          "it to DECLARED_SPAN_ATTRIBUTES above. That is the point of this",
          "test, not an obstacle to it -- an exact set is the only kind that",
          "fails when someone adds a field, and adding is the risk here.",
          "",
          "Before declaring anything new, ask who can read the sink. If that is",
          "anyone beyond the readers of this tenant's data, it does not go there.",
        ].join("\n"),
      ).toEqual(DECLARED_SPAN_ATTRIBUTES);
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
