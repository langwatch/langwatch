// @vitest-environment jsdom
import {
  UiHostServiceProvider,
  type UiHostServiceSource,
  useHostService,
} from "@langwatch/browser-host/capabilities";
import { hostService } from "@langwatch/browser-host/declarations";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

type Clock = { now: () => number };
const ClockService = hostService<UiHostServiceSource<Clock>>("clock");

describe("useHostService", () => {
  describe("given the runtime published a host service's value", () => {
    /** @scenario A host service's hook reads the value its source produced this render */
    it("returns that value", () => {
      const value: Clock = { now: () => 7 };
      const wrapper = ({ children }: { children: ReactNode }) => (
        <UiHostServiceProvider value={new Map([["clock", value]])}>
          {children}
        </UiHostServiceProvider>
      );

      const { result } = renderHook(() => useHostService(ClockService), { wrapper });

      expect(result.current).toBe(value);
    });
  });

  describe("given no shell published it", () => {
    it("returns undefined", () => {
      const { result } = renderHook(() => useHostService(ClockService));

      expect(result.current).toBeUndefined();
    });
  });
});
