import type { StateProjectionStore } from "@langwatch/eventing";
import { SSO_CONNECTION_EVENT_TYPES } from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";

import {
  type SsoConnectionFoldState,
  SsoConnectionStateFoldProjection,
} from "../../eventing/sso-connection-state.projection.ts";
import { SENDER_NAME_BY_COMMAND } from "../eventing-sso-connection-ledger.service.ts";
import { CONNECTION_COMMAND_NAMES } from "../sso-connection-pipeline-definition.service.ts";

/**
 * The ledger names a queue sender per command and the pipeline registers the
 * senders: two tables in two files, and a verb in one but not the other is a
 * 500 the customer meets on save. Spec: specs/identity/sso-activation.feature.
 */
describe("given the ledger's sender names and the pipeline's command table", () => {
  const staged = Object.values(SENDER_NAME_BY_COMMAND).toSorted();
  const carried = CONNECTION_COMMAND_NAMES.toSorted();

  describe("when the ledger stages any command by name", () => {
    /** @scenario "Every verb the ledger can stage is one the pipeline will carry" */
    it("finds every name registered on the pipeline", () => {
      expect(carried).toEqual(expect.arrayContaining(staged));
    });
  });

  describe("when the pipeline declares a sender", () => {
    /** @scenario "Every verb the ledger can stage is one the pipeline will carry" */
    it("declares none the ledger cannot reach", () => {
      expect(staged).toEqual(expect.arrayContaining(carried));
    });
  });
});

describe("given the aggregate's event vocabulary and the projection's subscriptions", () => {
  describe("when any event the aggregate states is stored", () => {
    /** @scenario "Every fact the aggregate can state is one the projection folds" */
    it("finds the projection subscribed to it", () => {
      const unusedStore: StateProjectionStore<SsoConnectionFoldState> = {
        tryLoad: async () => null,
        store: async () => {},
      };
      const folded = new SsoConnectionStateFoldProjection({ store: unusedStore }).eventTypes;

      expect(folded.toSorted()).toEqual(SSO_CONNECTION_EVENT_TYPES.toSorted());
    });
  });
});
