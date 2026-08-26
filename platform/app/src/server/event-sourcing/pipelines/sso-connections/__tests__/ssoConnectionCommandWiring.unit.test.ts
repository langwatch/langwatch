import { describe, expect, it } from "vitest";
import { SENDER_NAME_BY_COMMAND } from "~/server/app-layer/identity/sso-connection-ledger";
import { CONNECTION_COMMANDS } from "../pipeline";
import { ssoConnectionEvents } from "../projections/ssoConnectionState.foldProjection";
import { ssoConnectionEventSchema } from "../schemas/events";

/**
 * The ledger names a queue sender per command; the pipeline registers the
 * senders. Two tables in two files, on purpose — the ledger must not import
 * the pipeline — and twice now a verb landed in one without the other, which
 * the customer met as a 500. This is the pin.
 *
 * @scenario "Every verb the ledger can stage is one the pipeline will carry"
 */
describe("given the ledger's sender names and the pipeline's command table", () => {
  const staged = Object.values(SENDER_NAME_BY_COMMAND).sort();
  const carried = CONNECTION_COMMANDS.map(([name]) => name).sort();

  describe("when the ledger stages any command by name", () => {
    it("finds every name registered on the pipeline", () => {
      expect(carried).toEqual(expect.arrayContaining(staged));
    });
  });

  describe("when the pipeline declares a sender", () => {
    it("declares none the ledger cannot reach", () => {
      expect(staged).toEqual(expect.arrayContaining(carried));
    });
  });
});

/**
 * The same defect from the read side: the projection subscribes to a LIST of
 * event schemas, and the executor drops any event outside it — no error, no
 * log, the head just stops being the truth. Five events sat in that gap, the
 * arrivals answer among them, and a customer's save read back unchanged.
 *
 * @scenario "Every fact the aggregate can state is one the projection folds"
 */
describe("given the wire union of connection events and the projection's subscriptions", () => {
  const union = ssoConnectionEventSchema.options
    .map((option) => option.shape.type.value)
    .sort();
  const folded = ssoConnectionEvents
    .map((schema) => schema.shape.type.value)
    .sort();

  describe("when any event in the union is stored", () => {
    it("finds the projection subscribed to it", () => {
      expect(folded).toEqual(union);
    });
  });
});
