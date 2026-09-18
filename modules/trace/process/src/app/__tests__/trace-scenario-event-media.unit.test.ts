import { StoredObjectApi } from "@langwatch/stored-object-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { TraceApp, type TraceAppDependencies } from "../trace.app.ts";
import type { TraceLegacyRead } from "../trace.members.ts";

function fixture(options: { storeFromBytes?: StoredObjectApi["storeFromBytes"] } = {}) {
  const storeFromBytes =
    options.storeFromBytes ??
    vi.fn<StoredObjectApi["storeFromBytes"]>().mockResolvedValue({
      reference: {
        projectId: "project-1",
        id: "stored-object-1",
        sha256: "a".repeat(64),
        byteLength: 11,
        filename: "scenario-event-media",
        mediaType: "image/png",
        audience: "scenarios:view",
      },
      isDuplicate: false,
    });
  const storedObjects = createApiFixture<StoredObjectApi>({ storeFromBytes });
  const app = TraceApp.create(
    createApiFixture<TraceAppDependencies>({
      storedObjects,
      traces: createApiFixture<TraceAppDependencies["traces"]>({
        read: createApiFixture<TraceLegacyRead>(),
      }),
    }),
  );

  return { app, storeFromBytes };
}

const input = {
  event: {
    type: "MESSAGE_SNAPSHOT",
    message: {
      role: "user",
      content: [
        {
          type: "image_url",
          image_url: {
            url: `data:image/png;base64,${Buffer.from("event media").toString("base64")}`,
          },
        },
      ],
    },
  },
  projectId: "project-1",
  ownerKind: "scenario_run" as const,
  ownerId: "scenario-run-1",
  purpose: "scenario_event" as const,
};

describe("TraceApi.extractInlineMediaFromEvent", () => {
  it("declares Stored Object as the required media peer", () => {
    expect(TraceApp.dependencies.storedObjects).toBe(StoredObjectApi);
  });

  /** @scenario "Inline file part is externalized and the event payload is rewritten by id" */
  it("stores scenario media through the required Stored Object peer and preserves the rewritten URL", async () => {
    const { app, storeFromBytes } = fixture();

    const result = await app.extractInlineMediaFromEvent(input);

    expect(storeFromBytes).toHaveBeenCalledWith({
      projectId: "project-1",
      filename: "scenario-event-media",
      mediaType: "image/png",
      audience: "scenarios:view",
      bytes: Buffer.from("event media"),
      purpose: "scenario_event",
      ownerKind: "scenario_run",
      ownerId: "scenario-run-1",
    });
    expect(result).toEqual({
      rewrittenEvent: {
        type: "MESSAGE_SNAPSHOT",
        message: {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: "/api/files/project-1/stored-object-1" },
            },
          ],
        },
      },
      refs: [
        {
          id: "stored-object-1",
          isDuplicate: false,
          purpose: "scenario_event",
          ownerKind: "scenario_run",
          ownerId: "scenario-run-1",
        },
      ],
    });
  });

  /** @scenario "Storage put failure aborts the entire event with a 5xx and no partial state" */
  it("propagates a stored-object failure", async () => {
    const storageFailure = new Error("storage unavailable");
    const { app } = fixture({
      storeFromBytes: vi.fn<StoredObjectApi["storeFromBytes"]>().mockRejectedValue(storageFailure),
    });

    await expect(app.extractInlineMediaFromEvent(input)).rejects.toBe(storageFailure);
  });
});
