import { describe, expect, it } from "vitest";
import { SENDER_NAME_BY_COMMAND } from "~/server/app-layer/identity/sso-connection-ledger";
import { CONNECTION_COMMANDS } from "../pipeline";

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
