import { describe, expect, it } from "vitest";
import { createShareInputSchema, resolveShareInputSchema, shareLinkSchema } from "../src";

describe("Share contract", () => {
  it("accepts the existing share-link response shape", () => {
    expect(
      shareLinkSchema.parse({
        id: "share_1",
        token: "token",
        resourceType: "TRACE",
        resourceId: "trace_1",
        threadId: null,
        projectId: "project_1",
        userId: null,
        visibility: "PUBLIC",
        expiresAt: null,
        maxViews: null,
        viewCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).toMatchObject({ id: "share_1", visibility: "PUBLIC" });
  });

  it("rejects an unsupported resource type", () => {
    expect(() =>
      createShareInputSchema.parse({
        projectId: "project_1",
        resourceType: "SPAN",
        resourceId: "span_1",
      }),
    ).toThrow();
  });

  it("requires an identity for a signed-in viewer", () => {
    expect(() =>
      resolveShareInputSchema.parse({
        token: "token",
        viewer: { type: "user" },
      }),
    ).toThrow();
  });
});
