/**
 * The contract's list of views the origin scope never reaches, derived from the live catalogue so
 * a view added or changed there fails here until the list follows.
 * @see specs/lwql/api.feature
 */
import { LWQL_ORIGIN_UNSCOPED_VIEWS } from "@langwatch/analytics-contract";
import { describe, expect, it } from "vitest";

import { isOriginScopedView } from "../langwatch-ql-query-scope.rules.ts";
import { LWQL_VIEW_CATALOG } from "../lwql-view-catalog.rules.ts";

describe("LWQL_ORIGIN_UNSCOPED_VIEWS", () => {
  it("lists exactly the catalogued views the origin scope does not reach", () => {
    const unscoped = LWQL_VIEW_CATALOG.filter(
      (view) =>
        !isOriginScopedView({ columns: new Set(view.columns.map((column) => column.name)) }),
    )
      .map((view) => view.name)
      .toSorted();

    expect([...LWQL_ORIGIN_UNSCOPED_VIEWS]).toEqual(unscoped);
  });
});
