// @vitest-environment jsdom
/**
 * `Heatmap` draws visible axis labels (hours across the top, weekdays down
 * the side) instead of an unlabeled grid of colored cells — Langy shipped a
 * heatmap with no way to read which cell was which hour/weekday.
 *
 * Rendered with real React (the same instance the sandboxed frame injects as
 * `window.React` — see the module doc in `../index.ts`) via
 * `renderToStaticMarkup`, since `Heatmap` itself uses no Recharts primitive
 * and needs no DOM, only `window.React`.
 *
 * @see specs/analytics/custom-chart-playground.feature
 */

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { Heatmap } from "../index";

declare const window: { React: unknown; Recharts?: unknown; LW?: unknown };

beforeEach(() => {
  window.React = React;
});

describe("Heatmap", () => {
  describe("when xKey is 'hour' and yKey is 'weekday', with no explicit labels", () => {
    it("draws the default hour and weekday labels", () => {
      const html = renderToStaticMarkup(
        Heatmap({
          data: [{ hour: 3, weekday: "Mon", count: 5 }],
          xKey: "hour",
          yKey: "weekday",
          valueKey: "count",
        }) as React.ReactElement,
      );

      expect(html).toContain(">3<");
      expect(html).toContain(">Mon<");
      // The full default label sets — every hour, every weekday — render, not
      // just the one row of data supplied.
      expect(html).toContain(">23<");
      expect(html).toContain(">Sun<");
    });
  });

  describe("when xLabels/yLabels are given explicitly", () => {
    it("draws those labels instead of the defaults", () => {
      const html = renderToStaticMarkup(
        Heatmap({
          data: [{ region: "EU", tier: "gold", count: 1 }],
          xKey: "region",
          yKey: "tier",
          valueKey: "count",
          xLabels: ["EU", "US"],
          yLabels: ["gold", "silver"],
        }) as React.ReactElement,
      );

      expect(html).toContain(">EU<");
      expect(html).toContain(">US<");
      expect(html).toContain(">gold<");
      expect(html).toContain(">silver<");
    });
  });
});
