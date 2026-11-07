/**
 * What a full grant shows is the yardstick for "hidden": every real view must be inside it, and a
 * view behind a cost permission must read as hidden to a caller lacking that permission.
 * @see specs/lwql/query-origin.feature
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import {
  fullGrantProtections,
  hiddenViewTables,
} from "../../rules/lwql-caller-access-refusal.rules.ts";
import { LWQL_CATALOG, LWQL_VIEW_CATALOG } from "../../rules/lwql-view-catalog.rules.ts";
import { LangWatchQLCatalogShapesService } from "../langwatch-ql-catalog-shapes.service.ts";
import { catalogueWithout } from "./lwql-catalogue-access.fixture.ts";

const shapes = LangWatchQLCatalogShapesService.create();
const fullGrant = fullGrantProtections({ catalog: LWQL_CATALOG });
const visibleTo = (protections: typeof fullGrant) =>
  shapes.visibleViews({ protections, views: LWQL_VIEW_CATALOG, catalog: LWQL_CATALOG });

describe("given the real view catalogue", () => {
  /** @scenario "A full grant shows every real view" */
  it("shows every view to a caller holding a full grant", () => {
    const shown = new Set(visibleTo(fullGrant).map((view) => view.name));

    expect(
      LWQL_VIEW_CATALOG.filter((view) => !shown.has(view.name)).map((view) => view.name),
    ).toEqual([]);
  });

  /** @scenario "A view behind a permission the caller lacks reads as hidden" */
  it("marks a view behind the cost permission hidden for a caller who lacks it", () => {
    const withoutCost = {
      ...fullGrant,
      catalogue: catalogueWithout("cost:view"),
    };

    const hidden = hiddenViewTables({
      database: "analytics",
      showable: visibleTo(fullGrant),
      visible: visibleTo(withoutCost),
    });

    expect(hidden).toContain("analytics.costs");
  });
});
