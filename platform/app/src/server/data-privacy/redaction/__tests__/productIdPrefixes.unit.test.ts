import { redactSecretsInText } from "@langwatch/redaction";
import { describe, expect, it } from "vitest";
import { KSUID_RESOURCES } from "~/utils/constants";

/**
 * A KSUID body, base62, of the length the app really mints.
 *
 * The shape rule needs a body of at least 26 characters before it fires, so a
 * shorter stand-in would pass this test while the real id still failed.
 */
const KSUID_BODY = "0005FFcHZ7IBvPE1OSWymml0ikKqB";

/**
 * Prefixes minted from a template literal rather than through
 * {@link KSUID_RESOURCES}, and the ones the app no longer mints but still
 * reads off stored rows. Kept here beside the registry walk so both halves of
 * the app's id vocabulary are covered by the same assertion.
 */
const TEMPLATE_LITERAL_PREFIXES = [
  "prompt",
  "agent",
  "suite",
  "workflow",
  "evaluator",
  "customeval",
  "record",
  "dataset",
  "doc",
  "ptag",
  "vtag",
  "llmcost",
  "langyturn",
  "mcp",
  "svc",
  "check",
  "evaluation",
  "scen",
  "mp",
];

/**
 * The app mints its ids as `prefix_<random body>`, which is the shape a vendor
 * mints an API key in. The shape rule tells them apart by the prefix alone, and
 * it reads the prefix up to the FIRST separator: the list held `scenario`, the
 * app mints `scenariorun_…`, and every simulation run id was replaced with a
 * marker at ingestion. Redaction cannot be undone, so the trace could never be
 * attached to its run again.
 *
 * This walks the app's own resource registry, so a resource added later is
 * covered without anyone remembering to add a case.
 */
describe("secrets redaction, given the ids the app mints", () => {
  const survives = (id: string) =>
    redactSecretsInText({ text: id }).text === id;

  /** @scenario "Every id prefix the product mints survives redaction" */
  it("leaves an id for every registered resource exactly as written", () => {
    const eaten = Object.values(KSUID_RESOURCES)
      .map((resource) => `${resource}_${KSUID_BODY}`)
      .filter((id) => !survives(id));
    expect(eaten).toEqual([]);
  });

  it("leaves an id for every template-literal prefix exactly as written", () => {
    const eaten = TEMPLATE_LITERAL_PREFIXES.map(
      (prefix) => `${prefix}_${KSUID_BODY}`,
    ).filter((id) => !survives(id));
    expect(eaten).toEqual([]);
  });

  describe("when a prefix names key material rather than a record", () => {
    // The exemption is per prefix, and the app mints its credentials with a
    // dash. A prefix added for its underscore form would exempt the dash form
    // with it, so the credential prefixes are checked from the other side.
    it("still redacts the credentials the app itself mints", () => {
      for (const key of [
        `sk-lw-${KSUID_BODY}`,
        `ik-lw-${KSUID_BODY}`,
        `pat-lw-${KSUID_BODY}`,
        `vk-lw-${KSUID_BODY}`,
      ]) {
        expect(redactSecretsInText({ text: key }).text).toBe("[SECRET]");
      }
    });
  });
});
