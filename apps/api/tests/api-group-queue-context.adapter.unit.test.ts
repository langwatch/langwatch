import { getCurrentContext, runWithContext } from "@langwatch/observability/context";
import { describe, expect, it } from "vitest";
import { ApiGroupQueueContextAdapter } from "../src/platform/infrastructure/api-group-queue-context.adapter";
import { ApiQueueInfrastructure } from "../src/platform/infrastructure/api-queue.infrastructure";
import { ResourceScope } from "@langwatch/runtime-composition";

describe("ApiGroupQueueContextAdapter", () => {
  it("captures request fields for queued work and restores them around handling", async () => {
    const adapter = ApiGroupQueueContextAdapter.create();
    const metadata = runWithContext(
      { organizationId: "org-1", projectId: "project-1", userId: "user-1" },
      () => adapter.capture(),
    );

    const observed = await adapter.run(metadata, async () => getCurrentContext());

    expect(metadata).toMatchObject({
      organizationId: "org-1",
      projectId: "project-1",
      userId: "user-1",
    });
    expect(observed).toEqual({ organizationId: "org-1", projectId: "project-1", userId: "user-1" });
  });

  it("fails closed when the physical API root has no Redis queue configuration", () => {
    expect(() =>
      ApiQueueInfrastructure.create({
        resources: new ResourceScope(),
        redis: { configured: false, reason: "unconfigured", warnings: [] },
      }),
    ).toThrow("requires configured Redis");
  });
});
