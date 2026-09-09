import { describe, expect, it, vi } from "vitest";
import { createApiFixture } from "../api-fixture.ts";

interface ExampleApi {
  get(id: string): Promise<string>;
  delete(id: string): Promise<void>;
}

describe("API fixtures", () => {
  it("throws a named error for an unconfigured method", () => {
    const api = createApiFixture<ExampleApi>({}, "ExampleApi");
    expect(() => api.get("one")).toThrow("ExampleApi.get is not configured for this test");
  });

  it("uses typed overrides while other methods remain unavailable", async () => {
    const get = vi.fn(async (id: string) => `record:${id}`);
    const api = createApiFixture<ExampleApi>({ get });
    await expect(api.get("one")).resolves.toBe("record:one");
    expect(get).toHaveBeenCalledWith("one");
    expect(() => api.delete("one")).toThrow("delete is not configured");
  });

  it("allows a test to replace a method without affecting another fixture", async () => {
    const first = createApiFixture<ExampleApi>();
    const second = createApiFixture<ExampleApi>();
    first.get = async () => "configured";
    await expect(first.get("one")).resolves.toBe("configured");
    expect(() => second.get("one")).toThrow("not configured");
    await expect(Promise.resolve(first)).resolves.toBe(first);
  });
});
