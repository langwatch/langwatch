/**
 * The trace filters port, absent and installed.
 * Spec: specs/traces/trace-list-page-size-cap.feature
 */

import { describe, expect, it } from "vitest";

import {
  BrowserUiDocumentTitle,
  resolveUiCapabilities,
  UiNavigation,
  UiRoute,
  UiTraceFilters,
  type UiTraceFilterReading,
} from "../capabilities.ts";

class InertNavigation extends UiNavigation {
  navigate(): void {}
  replace(): void {}
  back(): void {}
}

class InertRoute extends UiRoute {
  reading() {
    return { params: {}, query: {}, pathname: "/" };
  }
  setQuery(): void {}
}

const READING: UiTraceFilterReading = { startDate: 1, endDate: 2, filters: { topics: ["a"] } };

class FixedTraceFilters extends UiTraceFilters {
  applied(): UiTraceFilterReading {
    return READING;
  }
}

function resolve({ install, live }: { install?: UiTraceFilters; live?: UiTraceFilters }) {
  return resolveUiCapabilities({
    install: install ? { traceFilters: install } : {},
    documentTitle: BrowserUiDocumentTitle.create(),
    navigation: new InertNavigation(),
    route: new InertRoute(),
    traceFilters: live,
  });
}

describe("the trace filters capability", () => {
  describe("given no module lent it", () => {
    it("resolves to no capability", () => {
      expect(resolve({}).traceFilters).toBeUndefined();
    });
  });

  describe("given the live host read one", () => {
    it("resolves to the live reading", () => {
      const live = new FixedTraceFilters();
      expect(resolve({ live }).traceFilters?.applied()).toBe(READING);
    });
  });

  describe("given the composition installed one beside a live reading", () => {
    it("prefers the installed port", () => {
      const install = new FixedTraceFilters();
      expect(resolve({ install, live: new FixedTraceFilters() }).traceFilters).toBe(install);
    });
  });
});
