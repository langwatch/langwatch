-- Chart cards move from a two-column grid with content-driven rows to an
-- eight-column grid with fixed 100px rows (server/analytics/chartGrid.ts).
--
-- Every existing placement is converted once, to the size and position that
-- renders at the same width and height it already had, so no dashboard
-- rearranges itself on the first load after this deploys:
--
--   * columns scale exactly: 2 old columns -> 8 new ones, so x4.
--   * rows scale by how many 100px rows the surface's old minimum row height
--     covered. The analytics dashboard laid cards out on 240px rows (x3);
--     the widget-authoring page, which is the only grid a `dashboard_srcdoc`
--     row was sized on, used 350px rows (x4).
--
-- IRREVERSIBLE: there is no down migration. The old values are recoverable
-- by dividing back, but the application no longer reads the old unit, so a
-- rollback would need the old grid components as well.

UPDATE "CustomGraph"
SET "gridColumn" = "gridColumn" * 4,
    "colSpan"    = "colSpan" * 4,
    "gridRow"    = "gridRow" * 3,
    "rowSpan"    = "rowSpan" * 3
WHERE "kind" <> 'dashboard_srcdoc';

UPDATE "CustomGraph"
SET "gridColumn" = "gridColumn" * 4,
    "colSpan"    = "colSpan" * 4,
    "gridRow"    = "gridRow" * 4,
    "rowSpan"    = "rowSpan" * 4
WHERE "kind" = 'dashboard_srcdoc';
