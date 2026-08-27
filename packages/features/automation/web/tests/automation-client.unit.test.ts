import { describe, expect, it, vi } from "vitest";
import { AutomationClient } from "../src";
describe("AutomationClient", () => {
  it("validates trigger rows at the browser boundary", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    expect(await new AutomationClient({ fetch }).list("project 1")).toEqual([]);
    expect(fetch).toHaveBeenCalledWith("/api/triggers?projectId=project%201");
  });
});
