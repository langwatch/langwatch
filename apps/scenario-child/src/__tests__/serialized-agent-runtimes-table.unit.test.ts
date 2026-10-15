/**
 * @vitest-environment node
 */

import { TARGET_RESOURCE_CLASS, TARGET_STOP_SIGNAL } from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import { SERIALIZED_AGENT_RUNTIMES } from "../channels/serialized-agent-channels.registry.ts";

describe("SERIALIZED_AGENT_RUNTIMES", () => {
  describe("given the child's runtime table", () => {
    /** @scenario "Each runtime is one row in the child's declared table" */
    it("has a row for every target type, carrying the class the contract declares", () => {
      expect(Object.keys(SERIALIZED_AGENT_RUNTIMES).toSorted()).toEqual(
        Object.keys(TARGET_RESOURCE_CLASS).toSorted(),
      );
      expect(
        Object.entries(SERIALIZED_AGENT_RUNTIMES).map(([type, row]) => [type, row.resourceClass]),
      ).toEqual(Object.entries(TARGET_RESOURCE_CLASS));
    });
  });

  describe("given the child's runtime table", () => {
    /** @scenario "Each runtime declares how its child is stopped" */
    it("carries the stop signal the contract declares for each type", () => {
      expect(
        Object.entries(SERIALIZED_AGENT_RUNTIMES).map(([type, row]) => [type, row.stopSignal]),
      ).toEqual(Object.entries(TARGET_STOP_SIGNAL));
    });
  });
});
