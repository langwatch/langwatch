/**
 * Whether a settled call earns a capability card at all.
 *
 * The failure this guards: one refused `scenario create` produced a red error
 * card AND a second card reading "Couldn't confirm the scenario was created",
 * because the agent retried the denial with different flags and the retry came
 * back naming nothing. Two cards, one event, and the second contradicted the
 * first. A result that cannot substantiate a claim now draws no card — the call
 * still appears in the turn's completed-steps receipt, and the failure card says
 * what actually happened.
 *
 * @see specs/langy/langy-capability-cards.feature
 *      "A write card never claims success on a result that names nothing"
 */
import { describe, expect, it } from "vitest";
import { hasCapabilityCard } from "../components/capabilities/LangyCapabilityRenderer";

const createCall = (output: unknown) => ({
  name: "langwatch.scenario.create",
  state: "output-available",
  input: { name: "Customer support agent" },
  output,
});

describe("hasCapabilityCard", () => {
  describe("given a create whose result names what it created", () => {
    it("earns a card", () => {
      expect(
        hasCapabilityCard(
          createCall({ id: "scenario_1", name: "Customer support agent" }),
        ),
      ).toBe(true);
    });
  });

  describe("given a create whose result names nothing", () => {
    it("earns no card for an empty list", () => {
      expect(hasCapabilityCard(createCall([]))).toBe(false);
    });

    it("earns no card for an empty object", () => {
      expect(hasCapabilityCard(createCall({}))).toBe(false);
    });

    it("earns no card when the envelope already recorded the doubt", () => {
      expect(
        hasCapabilityCard({
          ...createCall(null),
          result: {
            kind: "card",
            card: "resourceCreated",
            payload: [],
            outcome: "unconfirmed",
          },
        }),
      ).toBe(false);
    });
  });

  describe("given a read whose result is genuinely empty", () => {
    it("still earns a card, because empty is a real answer", () => {
      expect(
        hasCapabilityCard({
          name: "langwatch.trace.search",
          state: "output-available",
          input: {},
          result: { kind: "card", card: "traces", payload: { traces: [] } },
          output: null,
        }),
      ).toBe(true);
    });
  });
});
