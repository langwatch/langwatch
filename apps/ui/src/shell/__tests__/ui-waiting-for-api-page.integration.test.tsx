/**
 * @vitest-environment jsdom
 * @see specs/ui/dev-public-config.feature
 */
import { createPublicAppConfigMetaTag } from "@langwatch/config/public-app-config";
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { UiWaitingForApiPage } from "../ui-waiting-for-api-page";

beforeAll(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("given a shell served before the api answered", () => {
  /** @scenario "The api is unreachable when the dev server starts" */
  it("shows the branded waiting card and reloads once the shell carries the config", async () => {
    vi.useFakeTimers();
    const meta = createPublicAppConfigMetaTag({ process: { mode: "development" } });
    const shells = ["<html><head></head></html>", `<html><head>${meta}</head></html>`];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(shells.shift() ?? "")),
    );
    const reload = vi.fn();
    vi.stubGlobal("location", { href: "http://app.test/settings", reload });

    render(
      <DesignSystemProvider>
        <UiWaitingForApiPage />
      </DesignSystemProvider>,
    );
    expect(screen.getByTestId("waiting-for-api-page")).toBeTruthy();
    expect(screen.getByText("LangWatch is starting")).toBeTruthy();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(reload).toHaveBeenCalledOnce();
  });
});
