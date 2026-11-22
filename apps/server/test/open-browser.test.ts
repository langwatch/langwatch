import { describe, expect, it, vi } from "vitest";

const execa = vi.fn();

vi.mock("execa", () => ({ execa }));
vi.mock("../src/shared/platform.ts", () => ({ isMac: () => true }));

const { openBrowser } = await import("../src/animation/open-browser.ts");

describe("openBrowser", () => {
  it("uses the injected no-open decision instead of reading process state", async () => {
    await openBrowser("http://localhost:5560", { openEnabled: false });

    expect(execa).not.toHaveBeenCalled();
  });
});
