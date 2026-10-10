import { describe, expect, it } from "vitest";

import {
  buildKickoff,
  firstNameOf,
  landingNeedsKickoff,
  landingNeedsTour,
  tourStatusForLanding,
} from "../tour-landing.ts";

describe("firstNameOf", () => {
  /** @scenario the kickoff greets the reader by their first name */
  it("takes the first word of a real name", () => {
    expect(firstNameOf("Riley Stone")).toBe("Riley");
  });

  it("answers undefined for an email or a blank name", () => {
    expect(firstNameOf("riley@acme.com")).toBeUndefined();
    expect(firstNameOf(undefined)).toBeUndefined();
    expect(firstNameOf("  ")).toBeUndefined();
  });
});

describe("landingNeedsTour", () => {
  /** @scenario the coding path queues the kickoff with no tour */
  it("is false for a path with no tour", () => {
    expect(landingNeedsTour({ paths: ["coding"], currentPath: "coding", donePaths: [] })).toBe(
      false,
    );
  });

  it("is true for a fresh path with a tour", () => {
    expect(landingNeedsTour({ paths: ["llmops"], currentPath: "llmops", donePaths: [] })).toBe(
      true,
    );
  });

  /** @scenario a skipped provider means no tour */
  it("is false once the tour has completed or been skipped", () => {
    expect(
      landingNeedsTour({
        paths: ["gateway"],
        currentPath: "gateway",
        donePaths: [],
        tourSkippedAt: "2026-09-05T10:00:00.000Z",
      }),
    ).toBe(false);
  });
});

describe("landingNeedsKickoff", () => {
  /** @scenario the tour never runs twice for the same path */
  it("is false once a conversation is attached", () => {
    expect(
      landingNeedsKickoff({
        paths: ["llmops"],
        currentPath: "llmops",
        donePaths: [],
        conversationId: "conv_1",
      }),
    ).toBe(false);
  });

  /** @scenario a reload after the tour queues the kickoff again only while no conversation is attached */
  it("is true while no conversation is attached", () => {
    expect(landingNeedsKickoff({ paths: ["llmops"], currentPath: "llmops", donePaths: [] })).toBe(
      true,
    );
  });
});

describe("tourStatusForLanding", () => {
  /** @scenario the coding path queues the kickoff with no tour */
  it("is none for a path with no tour", () => {
    expect(
      tourStatusForLanding({ paths: ["coding"], currentPath: "coding", donePaths: [] }, "coding"),
    ).toBe("none");
  });

  /** @scenario a skipped provider means no tour */
  it("is skipped when skipped and not completed", () => {
    expect(
      tourStatusForLanding(
        {
          paths: ["gateway"],
          currentPath: "gateway",
          donePaths: [],
          tourSkippedAt: "2026-09-05T10:00:00.000Z",
        },
        "gateway",
      ),
    ).toBe("skipped");
  });

  it("is completed otherwise", () => {
    expect(
      tourStatusForLanding(
        {
          paths: ["llmops"],
          currentPath: "llmops",
          donePaths: [],
          tourCompletedAt: "2026-09-05T10:00:00.000Z",
        },
        "llmops",
      ),
    ).toBe("completed");
  });
});

describe("buildKickoff", () => {
  /** @scenario the kickoff is queued exactly once when the tour ends */
  it("carries the state's fields plus who to greet and how the tour ended", () => {
    const kickoff = buildKickoff({
      path: "llmops",
      state: {
        paths: ["llmops", "gateway"],
        currentPath: "llmops",
        donePaths: [],
        provider: "openai",
        providerModel: "gpt-5",
      },
      orgName: "ACME",
      firstName: "Riley",
      tourStatus: "completed",
    });
    expect(kickoff).toEqual({
      path: "llmops",
      paths: ["llmops", "gateway"],
      provider: "openai",
      providerModel: "gpt-5",
      orgName: "ACME",
      firstName: "Riley",
      tourStatus: "completed",
      gatewayUrl: undefined,
      virtualKeyName: undefined,
      virtualKeyPreview: undefined,
      virtualKeyRevealId: undefined,
      conversationId: null,
    });
  });
});
