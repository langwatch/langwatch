/**
 * The addresses, methods, permissions and operation ids the two timeseries REST
 * doors publish. Pinned because a generated SDK holds every one of them.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import { analyticsLegacyRest } from "../analytics-legacy.rest.ts";
import { analyticsRest } from "../analytics.rest.ts";

describe("given the canonical analytics REST family", () => {
  const declaration = analyticsRest.router();

  describe("when its addressing is read", () => {
    it("hangs its routes off the dated /api/analytics namespace behind a project key", () => {
      expect({
        namespace: declaration.namespace,
        addressing: declaration.addressing,
        v1Twin: declaration.v1Twin,
        credential: declaration.credential,
      }).toEqual({
        namespace: "analytics",
        addressing: "dated",
        v1Twin: true,
        credential: "projectKey",
      });
    });
  });

  describe("when its routes are read", () => {
    it("publishes the one timeseries endpoint behind analytics:view", () => {
      expect(
        declaration.routes.map((route) => ({
          method: route.method,
          path: route.path,
          operation: route.operation,
          permission: route.permission,
        })),
      ).toEqual([
        {
          method: "post",
          path: "/timeseries",
          operation: "queryAnalyticsTimeseries",
          permission: "analytics:view",
        },
      ]);
    });
  });
});

describe("given the legacy analytics REST family", () => {
  const declaration = analyticsLegacyRest.router();

  describe("when its addressing is read", () => {
    it("publishes the whole address literally, with its /api/v1 twin", () => {
      expect({
        namespace: declaration.namespace,
        addressing: declaration.addressing,
        v1Twin: declaration.v1Twin,
      }).toEqual({ namespace: "analytics-legacy", addressing: "literal", v1Twin: true });
    });
  });

  describe("when its one route is read", () => {
    const [route] = declaration.routes;

    it("answers POST /api/analytics behind analytics:view", () => {
      expect({
        method: route?.method,
        path: route?.path,
        operation: route?.operation,
        permission: route?.permission,
      }).toEqual({
        method: "post",
        path: "/api/analytics",
        operation: "queryAnalyticsTimeseriesLegacy",
        permission: "analytics:view",
      });
    });

    it("reads its own body, so the refusal sentence is built from the schema's failure", () => {
      expect(route?.rawBody).toEqual({ form: "text", mediaType: "application/json" });
    });

    it("declares the 400 refusal as an answer rather than leaving it to a boundary", () => {
      expect(Object.keys(route?.answers ?? {})).toEqual(["200", "400"]);
    });
  });
});
