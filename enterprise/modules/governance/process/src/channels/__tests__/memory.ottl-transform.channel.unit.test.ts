import { describe, expect, it } from "vitest";
import { OttlGatewayUnavailableError } from "../ottl-transform.channel.ts";
import { MemoryOttlTransformChannel } from "../memory/memory.ottl-transform.channel.ts";

describe("MemoryOttlTransformChannel", () => {
  describe("given no canned answers were provided", () => {
    describe("when validate is called", () => {
      it("defers with the same reason the live channel gives when unconfigured", async () => {
        const result = await MemoryOttlTransformChannel.create().validate(["set(foo, 1)"]);

        expect(result).toEqual({ status: "deferred", reason: "gateway_unconfigured" });
      });
    });

    describe("when transform is called", () => {
      it("refuses rather than fabricating a transform that never ran", async () => {
        await expect(
          MemoryOttlTransformChannel.create().transform({
            sourceId: "source-1",
            kind: "log",
            encoding: "json",
            payloadB64: "cGF5bG9hZA==",
            statements: ["set(foo, 1)"],
          }),
        ).rejects.toBeInstanceOf(OttlGatewayUnavailableError);
      });
    });
  });

  describe("given a test configures a specific validation result", () => {
    describe("when validate is called", () => {
      it("answers with exactly what the test asked for", async () => {
        const channel = MemoryOttlTransformChannel.create({
          validationResult: { status: "valid" },
        });

        const result = await channel.validate(["set(foo, 1)"]);

        expect(result).toEqual({ status: "valid" });
      });
    });
  });

  describe("given a test configures a transform result", () => {
    describe("when transform is called", () => {
      it("hands the input to the configured function and returns its answer", async () => {
        const channel = MemoryOttlTransformChannel.create({
          transform: (input) => ({
            ok: true,
            payloadB64: input.payloadB64,
            encoding: input.encoding,
          }),
        });

        const result = await channel.transform({
          sourceId: "source-1",
          kind: "metric",
          encoding: "proto",
          payloadB64: "cGF5bG9hZA==",
          statements: [],
        });

        expect(result).toEqual({ ok: true, payloadB64: "cGF5bG9hZA==", encoding: "proto" });
      });
    });
  });
});
