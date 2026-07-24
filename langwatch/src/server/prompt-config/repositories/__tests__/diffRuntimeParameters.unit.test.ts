import { describe, expect, it } from "vitest";
import { diffRuntimeParameters } from "../llm-config-version-schema";

describe("diffRuntimeParameters()", () => {
  describe("when comparing local and remote runtime parameters", () => {
    describe("given both sides are equal", () => {
      it("returns no differences", () => {
        expect(
          diffRuntimeParameters({
            localParameters: { max_tokens: 500 },
            remoteParameters: { max_tokens: 500 },
          }),
        ).toEqual([]);
      });

      it("treats undefined/null/empty object as equivalent", () => {
        expect(
          diffRuntimeParameters({
            localParameters: undefined,
            remoteParameters: null,
          }),
        ).toEqual([]);
        expect(
          diffRuntimeParameters({ localParameters: null, remoteParameters: {} }),
        ).toEqual([]);
      });
    });

    describe("given a shared key changed value", () => {
      it("describes the change in local → remote order", () => {
        expect(
          diffRuntimeParameters({
            localParameters: { max_tokens: 1000 },
            remoteParameters: { max_tokens: 500 },
          }),
        ).toEqual(["max_tokens: 1000 → 500"]);
      });
    });

    describe("given a key only present on one side", () => {
      it("describes a key added on the local side", () => {
        expect(
          diffRuntimeParameters({
            localParameters: { seed: 42 },
            remoteParameters: {},
          }),
        ).toEqual(["seed: 42 → undefined"]);
      });

      it("describes a key only present on the remote side", () => {
        expect(
          diffRuntimeParameters({
            localParameters: {},
            remoteParameters: { seed: 42 },
          }),
        ).toEqual(["seed: undefined → 42"]);
      });
    });

    describe("given multiple keys changed", () => {
      it("describes every changed key", () => {
        const result = diffRuntimeParameters({
          localParameters: { max_tokens: 1000, top_p: 0.9 },
          remoteParameters: { max_tokens: 500, top_p: 0.5 },
        });
        expect(result).toEqual([
          "max_tokens: 1000 → 500",
          "top_p: 0.9 → 0.5",
        ]);
      });
    });
  });
});
