import { describe, expect, it } from "vitest";

import { AppTraceRuntime } from "~/runtime/app/features/trace";
import { TestModelProviderService } from "~/server/modelProviders/__tests__/model-provider-services.test-support";

describe("AppTraceRuntime", () => {
  it("uses the empty Trace service when ClickHouse is unavailable", async () => {
    const traces = AppTraceRuntime.createNull(new TestModelProviderService());
    const page = await traces.getSpanTreePage({
      projectId: "project_1",
      traceId: "trace_1",
      limit: 1,
      canSeeCosts: false,
    });

    expect(page).toEqual({ nodes: [], nextCursor: null });
  });
});
