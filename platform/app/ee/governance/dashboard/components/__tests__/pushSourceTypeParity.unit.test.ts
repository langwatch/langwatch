/**
 * The service's PUSH_SOURCE_TYPES and the catalog's mode:"push" entries must
 * agree. They live in different modules (the catalog is React, the service is
 * Node) so they can't share a constant. This test is the compile-time guard.
 *
 * If it fails, a source type was added to one side but not the other.
 */

import { isPushSourceType } from "@ee/governance/services/activity-monitor/ingestionSource.service";
import { describe, expect, it } from "vitest";
import { SOURCE_TYPE_OPTIONS } from "../ingestionSourceCatalog";

describe("push source type parity", () => {
  it("every catalog push-mode type is recognized by the service", () => {
    const catalogPush = SOURCE_TYPE_OPTIONS.filter(
      (o) => o.mode === "push",
    ).map((o) => o.value);
    const missing = catalogPush.filter((t) => !isPushSourceType(t));
    expect(missing).toEqual([]);
  });

  it("every service push type has mode:push in the catalog", () => {
    const servicePush = SOURCE_TYPE_OPTIONS.filter((o) =>
      isPushSourceType(o.value),
    ).map((o) => o.value);
    const wrongMode = servicePush.filter((t) => {
      const option = SOURCE_TYPE_OPTIONS.find((o) => o.value === t);
      return option?.mode !== "push";
    });
    expect(wrongMode).toEqual([]);
  });
});
