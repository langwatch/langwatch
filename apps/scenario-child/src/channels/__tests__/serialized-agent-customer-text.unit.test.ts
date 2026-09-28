import { describe, expect, it } from "vitest";

import { formatHttpError } from "../../rules/execution-error.rules.ts";

describe("the agent failure text a customer reads", () => {
  it("keeps the old adapter name in the NLP service failure headline", () => {
    const { message } = formatHttpError({ status: 503, rawBody: "" });

    expect(message).toContain("SerializedCodeAgentAdapter: NLP service returned HTTP 503.");
  });
});
