/**
 * @vitest-environment node
 *
 * Keeps what we tell customers is billable in step with what the meter bills.
 *
 * The list is imported from the projection rather than transcribed, so adding a
 * type to `orgBillableEventsMeterProjection.eventTypes` fails here until the
 * documentation names it. That direction is the one that costs money silently:
 * a customer who plans around the documented list and is charged for something
 * else finds out on an invoice.
 *
 * The short answers are checked by family rather than by event type. They are
 * deliberately not the full list — they exist so someone skimming the pricing
 * page can size their own workload — but "spans" alone understates the bill for
 * anyone running evaluations, experiments or simulations.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { orgBillableEventsMeterProjection } from "../orgBillableEventsMeter.mapProjection";

// Repo root containing both `langwatch/` and `docs/`. `process.cwd()` is the
// langwatch/ package dir when vitest runs, so one level up lands on the repo
// root reliably across worktrees and CI.
const REPO_ROOT = path.resolve(process.cwd(), "..");

const BILLABLE_EVENTS_DOC = "docs/pricing/billable-events.mdx";
const PRICING_DOC = "docs/pricing.mdx";

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

/** Event-type slugs the docs present in backticks, e.g. `lw.evaluation.reported`. */
function documentedEventTypes(): Set<string> {
  const doc = readRepoFile(BILLABLE_EVENTS_DOC);
  return new Set(doc.match(/`(lw\.[a-z0-9_.]+)`/g)?.map((m) => m.slice(1, -1)));
}

/**
 * The four families a customer recognises, and the words the short answers may
 * use for each. Checking words rather than event types is the point: the short
 * answer speaks the customer's language, so it may say "simulation" or
 * "scenario" for `lw.simulation_run.*` and must not be forced to say either.
 */
const BILLABLE_FAMILIES: { family: string; synonyms: RegExp }[] = [
  { family: "spans", synonyms: /\bspans?\b/i },
  { family: "evaluations", synonyms: /\bevaluations?\b/i },
  { family: "experiments", synonyms: /\bexperiments?\b/i },
  { family: "simulations", synonyms: /\b(simulations?|scenarios?)\b/i },
];

/**
 * The definition itself — the "a billable event is ..." lead-in and the bullets
 * under it — not the whole `## Events` section. Scoped this tightly on purpose:
 * the section also links to the full list, and a pointer that happens to say
 * "an experiment sweep" would otherwise satisfy a check on the definition while
 * the definition still left experiments out. That is exactly the state this
 * test was written to catch.
 */
function pricingDefinition(): string {
  const doc = readRepoFile(PRICING_DOC);
  const definition = /A \*\*billable event\*\* is[^\n]*\n([\s\S]*?)\n\n/.exec(
    doc,
  );
  if (!definition) {
    throw new Error(`No billable-event definition in ${PRICING_DOC}`);
  }
  return definition[1]!;
}

/** The `## Events` section of the pricing page, up to the next H2. */
function pricingEventsSection(): string {
  const doc = readRepoFile(PRICING_DOC);
  const section = /\n## Events\n([\s\S]*?)(?=\n## )/.exec(doc);
  if (!section) {
    throw new Error(`No "## Events" section in ${PRICING_DOC}`);
  }
  return section[1]!;
}

/** The billable-event answer inside the pricing page's FAQ accordion. */
function pricingFaqAnswer(): string {
  const doc = readRepoFile(PRICING_DOC);
  const answer =
    /<Accordion title="What counts as a billable event\?">([\s\S]*?)<\/Accordion>/.exec(
      doc,
    );
  if (!answer) {
    throw new Error(`No billable-event accordion in ${PRICING_DOC}`);
  }
  return answer[1]!;
}

describe("Billable-event documentation", () => {
  describe("when a customer reads only the short answer", () => {
    /** @scenario "The Events section covers all four billable families" */
    it.each(
      BILLABLE_FAMILIES,
    )("names $family in the pricing-page definition", ({ synonyms }) => {
      expect(pricingDefinition()).toMatch(synonyms);
    });

    /** @scenario "The Events section covers all four billable families" */
    it("sends the reader to the full list for the counting rules", () => {
      expect(pricingEventsSection()).toContain("/pricing/billable-events");
    });

    /** @scenario "The pricing FAQ answer covers all four billable families" */
    it.each(BILLABLE_FAMILIES)("names $family in the pricing FAQ answer", ({
      synonyms,
    }) => {
      expect(pricingFaqAnswer()).toMatch(synonyms);
    });
  });

  describe("when the meter and the documented list are compared", () => {
    /** @scenario "Every event type the meter bills appears in the documented list" */
    it("documents every event type the meter subscribes to", () => {
      const documented = documentedEventTypes();
      const undocumented = orgBillableEventsMeterProjection.eventTypes.filter(
        (type) => !documented.has(type),
      );

      expect(undocumented).toEqual([]);
    });

    /** @scenario "The documented list bills nothing the meter does not" */
    it("advertises nothing the meter does not bill", () => {
      const metered = new Set<string>(
        orgBillableEventsMeterProjection.eventTypes,
      );
      const overclaimed = [...documentedEventTypes()].filter(
        (type) => !metered.has(type),
      );

      expect(overclaimed).toEqual([]);
    });
  });
});
