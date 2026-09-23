// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import {
  INERT_UI_ANALYTICS,
  UiAnalytics,
  useUiAnalytics,
  type UiAnalyticsEvent,
} from "../analytics.ts";
import {
  resolveUiCapabilities,
  UiCapabilityContextProvider,
  UNAVAILABLE_UI_SESSION,
  type UiCapabilities,
} from "../capabilities.ts";
import { createUiCapabilitiesFromHost } from "../testing.ts";

class RecordingUiAnalytics extends UiAnalytics {
  readonly tracked: UiAnalyticsEvent[] = [];

  track(event: UiAnalyticsEvent): void {
    this.tracked.push(event);
  }

  identify(): void {}

  group(): void {}

  reset(): void {}
}

const host = { route: () => ({ params: {}, query: {} }), navigate: () => {} };

function mount(capabilities: UiCapabilities) {
  return renderHook(() => useUiAnalytics(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <UiCapabilityContextProvider value={capabilities}>{children}</UiCapabilityContextProvider>
    ),
  });
}

describe("the UI analytics capability", () => {
  it("hands a module the destination the shell composed", () => {
    const analytics = new RecordingUiAnalytics();
    const { result } = mount({ ...createUiCapabilitiesFromHost(host), analytics });

    result.current.track({ name: "project", action: "created", boundary: "onboarding" });

    expect(analytics.tracked).toEqual([
      { name: "project", action: "created", boundary: "onboarding" },
    ]);
  });

  it("carries the emitting module's own attributes through untouched", () => {
    const analytics = new RecordingUiAnalytics();
    const { result } = mount({ ...createUiCapabilitiesFromHost(host), analytics });

    result.current.track({ name: "trace", attributes: { count: 3, source: "explorer" } });

    expect(analytics.tracked[0]?.attributes).toEqual({ count: 3, source: "explorer" });
  });

  it("drops events instead of crashing a screen mounted outside the shell", () => {
    const { result } = renderHook(() => useUiAnalytics());

    expect(result.current).toBe(INERT_UI_ANALYTICS);
    expect(() => result.current.track({ name: "anything" })).not.toThrow();
  });

  it("reads a composition that installed no destination as the inert one", () => {
    const resolved = resolveUiCapabilities({
      install: {},
      documentTitle: createUiCapabilitiesFromHost(host).documentTitle,
      navigation: createUiCapabilitiesFromHost(host).navigation,
      route: createUiCapabilitiesFromHost(host).route,
      session: UNAVAILABLE_UI_SESSION,
    });
    const { result } = mount(resolved);

    expect(result.current).toBe(INERT_UI_ANALYTICS);
  });

  it("keeps an installed destination ahead of the inert default", () => {
    const analytics = new RecordingUiAnalytics();
    const resolved = resolveUiCapabilities({
      install: { analytics },
      documentTitle: createUiCapabilitiesFromHost(host).documentTitle,
      navigation: createUiCapabilitiesFromHost(host).navigation,
      route: createUiCapabilitiesFromHost(host).route,
      session: UNAVAILABLE_UI_SESSION,
    });

    expect(resolved.analytics).toBe(analytics);
  });
});
