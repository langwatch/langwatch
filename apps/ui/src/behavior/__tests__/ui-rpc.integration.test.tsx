/**
 * The by-path dispatcher reaches a screen as a CAPABILITY, not through a
 * context of its own — record 10.1 rules out ambient React context as a
 * cross-module transport.
 * @vitest-environment jsdom
 */

import {
  resolveUiCapabilities,
  UiCapabilityContextProvider,
  UiCapabilityUnavailableError,
  UiNavigation,
  UiRoute,
  BrowserUiDocumentTitle,
  type UiCapabilities,
  type UiRouteReadingValues,
} from "@langwatch/browser-host/capabilities";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { UiRpc, useUiRpc, type UiRpcSubscription } from "../ui-rpc";

class InertUiNavigation extends UiNavigation {
  navigate(): void {}
  replace(): void {}
  back(): void {}
}

class InertUiRoute extends UiRoute {
  reading(): UiRouteReadingValues {
    return { params: {}, query: {} };
  }

  setQuery(): void {}
}

/** Answers the one path this test asks for and refuses the rest by name. */
class RecordedUiRpc extends UiRpc {
  query(path: string): Promise<unknown> {
    return Promise.resolve({ path });
  }

  mutate(): Promise<unknown> {
    throw new Error("this test mutates nothing");
  }

  subscribe(): UiRpcSubscription {
    throw new Error("this test subscribes to nothing");
  }
}

function capabilitiesWith(rpc?: UiRpc): UiCapabilities {
  return resolveUiCapabilities({
    install: {},
    documentTitle: BrowserUiDocumentTitle.create(),
    navigation: new InertUiNavigation(),
    route: new InertUiRoute(),
    ...(rpc ? { rpc } : {}),
  });
}

function mounted(capabilities: UiCapabilities) {
  return ({ children }: { children: ReactNode }) => (
    <UiCapabilityContextProvider value={capabilities}>{children}</UiCapabilityContextProvider>
  );
}

describe("given a shell that composed the by-path dispatcher", () => {
  it("hands it to a screen through the capabilities", async () => {
    const { result } = renderHook(() => useUiRpc(), {
      wrapper: mounted(capabilitiesWith(new RecordedUiRpc())),
    });

    await expect(result.current.query("organization.getAll", {})).resolves.toEqual({
      path: "organization.getAll",
    });
  });
});

describe("given a screen mounted with no dispatcher above it", () => {
  it("refuses by name rather than answering with a fabricated result", () => {
    const { result } = renderHook(() => useUiRpc(), { wrapper: mounted(capabilitiesWith()) });

    expect(() => result.current.query("organization.getAll", {})).toThrow(
      UiCapabilityUnavailableError,
    );
  });

  it("refuses the same way outside the shell entirely", () => {
    const { result } = renderHook(() => useUiRpc());

    expect(() => result.current.mutate("organization.update", {})).toThrow(
      UiCapabilityUnavailableError,
    );
  });
});
