/**
 * The blank workbench the REST create call builds, pinned against the client
 * default it replicates.
 *
 * The two definitions exist apart on purpose — the client one is browser code
 * and must not be imported by a backend process — so this is what keeps them
 * from drifting. Only the setup is compared: the client default carries three
 * sample rows a REST caller has not asked for.
 */
import { describe, expect, it } from "vitest";
import { createInitialState } from "~/experiments-v3/types";
import {
  extractPersistedState,
  persistedEvaluationsV3StateSchema,
} from "~/experiments-v3/types/persistence";
import { createBlankWorkbenchState } from "../blankWorkbenchState";

describe("the blank workbench state", () => {
  describe("given the persisted state schema", () => {
    /** @scenario "A create call with no setup stores a workbench that loads" */
    it("parses", () => {
      const parsed = persistedEvaluationsV3StateSchema.safeParse(
        createBlankWorkbenchState(),
      );

      expect(parsed.success).toBe(true);
    });
  });

  describe("given the client's own initial state", () => {
    /** @scenario "The server blank matches the workbench a browser starts from" */
    it("carries the same dataset, columns, targets and evaluators", () => {
      const client = extractPersistedState(createInitialState());
      const server = createBlankWorkbenchState();

      expect(server.name).toBe(client.name);
      expect(server.activeDatasetId).toBe(client.activeDatasetId);
      expect(server.targets).toEqual(client.targets);
      expect(server.evaluators).toEqual(client.evaluators);
      expect(server.datasets).toHaveLength(client.datasets.length);
      expect(server.datasets[0]?.id).toBe(client.datasets[0]?.id);
      expect(server.datasets[0]?.type).toBe(client.datasets[0]?.type);
      expect(server.datasets[0]?.columns).toEqual(client.datasets[0]?.columns);
      expect(server.datasets[0]?.inline?.columns).toEqual(
        client.datasets[0]?.inline?.columns,
      );
    });

    /** @scenario "The server blank starts with no rows" */
    it("starts empty where the client seeds sample rows", () => {
      const server = createBlankWorkbenchState();

      expect(server.datasets[0]?.inline?.records).toEqual({
        input: [],
        expected_output: [],
      });
    });
  });

  describe("when a name is given", () => {
    it("names the workbench with it", () => {
      expect(createBlankWorkbenchState({ name: "Checkout" }).name).toBe(
        "Checkout",
      );
    });
  });
});
