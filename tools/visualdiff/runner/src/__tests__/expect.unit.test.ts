import { describe, expect, it } from "vitest";

import { describeExpect, judgeBody, judgeCount, pollExpect, readField } from "../flows/expect";

describe("Feature: visualdiff flows assert outcomes", () => {
  describe("given an api expect on a list body", () => {
    const body = { data: [{ name: "VD Alert" }, { name: "Other" }] };

    /** @scenario A flow's expect proves the feature did its job on both sides */
    it("holds when the field contains the text, has enough items or equals the value", () => {
      expect(judgeBody({ body, args: { api: "/api/x", field: "data", contains: "VD Alert" } })).toBe("");
      expect(judgeBody({ body, args: { api: "/api/x", field: "data", min: "2" } })).toBe("");
      expect(judgeBody({ body, args: { api: "/api/x", field: "data.0.name", equals: "VD Alert" } })).toBe("");
    });

    /** @scenario A flow's expect proves the feature did its job on both sides */
    it("says why when it does not hold", () => {
      expect(judgeBody({ body, args: { api: "/api/x", field: "data", contains: "Nope" } })).toBe(
        'data lacks "Nope"',
      );
      expect(judgeBody({ body, args: { api: "/api/x", field: "data", min: "3" } })).toBe(
        "found 2, want at least 3",
      );
      expect(readField({ body, path: "data.5.name" })).toBeUndefined();
    });
  });

  describe("given a count expect", () => {
    it("checks an exact count or a minimum", () => {
      expect(judgeCount({ found: 3, args: { equals: "3" } })).toBe("");
      expect(judgeCount({ found: 0, args: {} })).toBe("found 0, want at least 1");
    });
  });

  describe("given an expect's arguments", () => {
    it("describes it in one line, the proof a passing expect records", () => {
      expect(describeExpect({ text: "VD Alert" })).toBe('text "VD Alert"');
      expect(describeExpect({ count: "role=row", min: "2" })).toBe("count role=row >= 2");
      expect(describeExpect({ api: "/api/triggers", contains: "VD" })).toBe(
        'api /api/triggers contains "VD"',
      );
    });
  });

  describe("given an expect that never holds", () => {
    /** @scenario An expect that times out fails its step with what it missed */
    it("polls until its timeout, then fails naming the expect and why", async () => {
      let reads = 0;
      const read = async (): Promise<string> => {
        reads += 1;
        return "not visible";
      };
      await expect(pollExpect({ read, args: { text: "VD Alert" }, timeout: 600 })).rejects.toThrow(
        'expect text "VD Alert": not visible after 600ms',
      );
      expect(reads).toBeGreaterThan(1);
    });

    it("stops polling as soon as it holds", async () => {
      let reads = 0;
      const read = async (): Promise<string> => (++reads < 2 ? "not yet" : "");
      await pollExpect({ read, args: { url: "/traces" }, timeout: 5000 });
      expect(reads).toBe(2);
    });
  });
});
