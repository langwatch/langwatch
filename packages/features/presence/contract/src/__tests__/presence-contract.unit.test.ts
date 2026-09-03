import { describe, expect, it } from "vitest";
import { presenceCursorEventSchema, presenceEventSchema, presenceLocationSchema } from "../index";

describe("presence contract", () => {
  const session = {
    sessionId: "tab-1",
    projectId: "project-1",
    user: { id: "user-1", name: "Ada", image: null },
    location: { lens: "traces" as const, route: { traceId: "trace-1" } },
    updatedAt: 1,
  };

  it("validates a portable location and durable snapshot", () => {
    expect(presenceLocationSchema.parse(session.location)).toEqual(session.location);
    expect(presenceEventSchema.parse({ kind: "snapshot", sessions: [session] })).toMatchObject({
      kind: "snapshot",
    });
  });

  it("rejects cursor coordinates outside the normalized viewport", () => {
    expect(() =>
      presenceCursorEventSchema.parse({
        projectId: "project-1",
        sessionId: "tab-1",
        user: session.user,
        anchor: "trace:trace-1",
        x: 2,
        y: 0.5,
        emittedAt: 1,
      }),
    ).toThrow();
  });
});
