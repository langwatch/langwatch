/**
 * @vitest-environment node
 *
 * Ensures documentation and meter stay in sync on billable events.
 * Silent billing for undocumented charges is the cost of getting this wrong.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { BillableEventsMeter } from "../../repositories/billable-events-meter.repository.ts";
import type { BillingTenantOrganizationService } from "../../services/tenant-organization.service.ts";
import { BillableEventsMeterProjection } from "../billable-events-meter.projection.ts";

// Repo root containing both `packages/` and `docs/`. `process.cwd()` is this
// package's own dir when vitest runs, and the package sits four levels down
// at enterprise/modules/billing/process, so four levels up lands on the root.
const REPO_ROOT = path.resolve(process.cwd(), "..", "..", "..", "..");

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
 * The four families a customer recognises, and words the short answer may
 * use for each. Checking words, not event types, is the point: it may say
 * "simulation" or "scenario" for `lw.simulation_run.*`, not forced to either.
 */
const BILLABLE_FAMILIES = [
  { family: "spans", synonyms: /\bspans?\b/i },
  { family: "evaluations", synonyms: /\bevaluations?\b/i },
  { family: "experiments", synonyms: /\bexperiments?\b/i },
  { family: "simulations", synonyms: /\b(simulations?|scenarios?)\b/i },
] as const;

/**
 * The definition itself — the "a billable event is ..." lead-in and its
 * bullets — not the whole `## Events` section. Scoped tightly so a stray
 * mention elsewhere can't mask the definition itself leaving something out.
 */
function pricingDefinition(): string {
  const doc = readRepoFile(PRICING_DOC);
  const definition = /A \*\*billable event\*\* is[^\n]*\n([\s\S]*?)\n\n/.exec(doc);
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
    /<Accordion title="What counts as a billable event\?">([\s\S]*?)<\/Accordion>/.exec(doc);
  if (!answer) {
    throw new Error(`No billable-event accordion in ${PRICING_DOC}`);
  }
  return answer[1]!;
}

const meteredEventTypes = BillableEventsMeterProjection.create({
  meter: { insert: vi.fn<BillableEventsMeter["insert"]>() },
  organizations: {} as unknown as BillingTenantOrganizationService,
}).build().eventTypes;

describe("Billable-event documentation", () => {
  describe("given the meter bills spans, evaluations, experiments and simulations", () => {
    describe("when a customer reads only the short answer", () => {
      /** @scenario "The Events section covers all four billable families" */
      it.each(BILLABLE_FAMILIES)("names $family in the pricing-page definition", ({ synonyms }) => {
        expect(pricingDefinition()).toMatch(synonyms);
      });

      /** @scenario "The Events section covers all four billable families" */
      it("sends the reader to the full list for the counting rules", () => {
        expect(pricingEventsSection()).toContain("/pricing/billable-events");
      });

      /** @scenario "The pricing FAQ answer covers all four billable families" */
      it.each(BILLABLE_FAMILIES)("names $family in the pricing FAQ answer", ({ synonyms }) => {
        expect(pricingFaqAnswer()).toMatch(synonyms);
      });
    });
  });

  describe("given the documentation claims to be the complete list", () => {
    describe("when the meter and the documented list are compared", () => {
      /** @scenario "Every event type the meter bills appears in the documented list" */
      it("documents every event type the meter subscribes to", () => {
        const documented = documentedEventTypes();
        const undocumented = meteredEventTypes.filter((type) => !documented.has(type));

        expect(undocumented).toEqual([]);
      });

      /** @scenario "The documented list bills nothing the meter does not" */
      it("advertises nothing the meter does not bill", () => {
        const metered = new Set<string>(meteredEventTypes);
        const overclaimed = [...documentedEventTypes()].filter((type) => !metered.has(type));

        expect(overclaimed).toEqual([]);
      });
    });
  });
});
