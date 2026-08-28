import { describe, expect, it } from "vitest";
import { createInnerTRPCContext } from "~/server/api/trpc.context";
import type { RequestAppServices } from "../requestApp";

describe("request application context", () => {
  /** @scenario RPC handlers use the request application from context */
  it("preserves an injected application service graph for transport tests", () => {
    const app = { agents: {} } as RequestAppServices;

    const context = createInnerTRPCContext({
      app,
      session: null,
    });

    expect(context.app).toBe(app);
  });
});
