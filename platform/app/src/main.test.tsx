// @vitest-environment jsdom

import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rootRender: vi.fn(),
  createRoot: vi.fn(),
}));

vi.mock("react-dom/client", () => ({
  createRoot: mocks.createRoot,
}));

vi.mock("./AppProviders", () => ({
  OuterProviders: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("./routes", () => ({
  router: { id: "app-router" },
}));

vi.mock("./utils/chunkReload", () => ({
  registerChunkReloadListener: vi.fn(),
}));

vi.mock("./utils/compat/next-router", () => ({
  setRouterInstance: vi.fn(),
}));

describe("application router scheduling", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.rootRender.mockReset();
    mocks.createRoot.mockReset();
    mocks.createRoot.mockReturnValue({ render: mocks.rootRender });
    document.body.innerHTML = '<div id="root"></div>';
  });

  it("commits route changes synchronously so the URL cannot outrun the page", async () => {
    await import("./main");

    const app = mocks.rootRender.mock.calls[0]?.[0] as ReactElement<{
      children: ReactElement<{
        children: ReactElement<{ useTransitions?: boolean }>;
      }>;
    }>;
    const routerProvider = app.props.children.props.children;

    expect(routerProvider.props.useTransitions).toBe(false);
  });
});
