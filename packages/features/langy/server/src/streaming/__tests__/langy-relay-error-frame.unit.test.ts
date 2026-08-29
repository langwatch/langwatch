import { describe, expect, it } from "vitest";
import { langyRelayFrameSchema } from "../langy-relay-frame";

describe("Langy relay error frames", () => {
  it("preserves explicit herr retryability", () => {
    const frame = langyRelayFrameSchema.parse({
      type: "error",
      error: "provider unavailable",
      herr: {
        type: "provider_unavailable",
        message: "provider unavailable",
        retryable: true,
      },
    });

    expect(frame.type).toBe("error");
    if (frame.type !== "error") {
      throw new Error("Expected the parsed relay frame to be an error");
    }

    expect(frame.herr?.retryable).toBe(true);
    expect(frame.herr?.serialize().retryable).toBe(true);
  });
});
