-- IRREVERSIBLE: no down step. This copies boards and widgets into new tables and v1 keeps its
-- own rows, so a rollback image ignores the new tables and runs as before. Dropping them would
-- lose every board created or edited in Dashboards v2 after this runs.

-- Dashboards v2 moves off the Analytics Reports tables onto its own (dashboards-v2.feature,
-- AC199 to AC199k). Additive and copy-only: no Dashboard or CustomGraph row is changed or
-- deleted, so the image still serving keeps reading and writing them. No foreign key, per the
-- database rule.
CREATE TABLE IF NOT EXISTS "DashboardsV2" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdById" TEXT,
    "scope" "DashboardScope" NOT NULL DEFAULT 'PROJECT',
    "organizationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DashboardsV2_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DashboardWidget" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "dashboardId" TEXT,
    "name" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "gridColumn" INTEGER NOT NULL DEFAULT 0,
    "gridRow" INTEGER NOT NULL DEFAULT 0,
    "colSpan" INTEGER NOT NULL DEFAULT 1,
    "rowSpan" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DashboardWidget_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DashboardsV2_projectId_idx" ON "DashboardsV2"("projectId");

CREATE INDEX IF NOT EXISTS "DashboardsV2_organizationId_scope_idx" ON "DashboardsV2"("organizationId", "scope");

CREATE INDEX IF NOT EXISTS "DashboardWidget_projectId_dashboardId_idx" ON "DashboardWidget"("projectId", "dashboardId");

-- A board is a Dashboards board when it holds a widget, carries a sign only Dashboards writes
-- (a star, a description, a scope other than Project, an organization), or is empty, has an
-- author and its project has used Dashboards (a widget or a star). It keeps its id, so stars and
-- insight pointers still name it. One holding Reports charts too stays listed in Reports, and
-- an empty board with none of these signs stays a Reports board only.
INSERT INTO "DashboardsV2" (
    "id", "projectId", "name", "description", "createdById", "scope", "organizationId",
    "createdAt", "updatedAt"
)
SELECT
    d."id", d."projectId", d."name", d."description", d."createdById", d."scope",
    d."organizationId", d."createdAt", d."updatedAt"
FROM "Dashboard" AS d
WHERE (
    EXISTS (
        SELECT 1 FROM "CustomGraph" AS widget
        WHERE widget."dashboardId" = d."id" AND widget."kind" = 'dashboard_srcdoc'
    )
    OR EXISTS (SELECT 1 FROM "DashboardFavourite" AS star WHERE star."dashboardId" = d."id")
    OR d."description" IS NOT NULL
    OR d."scope" <> 'PROJECT'
    OR d."organizationId" IS NOT NULL
    OR (
        d."createdById" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "CustomGraph" AS chart WHERE chart."dashboardId" = d."id")
        AND (
            EXISTS (
                SELECT 1 FROM "CustomGraph" AS used
                WHERE used."projectId" = d."projectId" AND used."kind" = 'dashboard_srcdoc'
            )
            OR EXISTS (
                SELECT 1 FROM "DashboardFavourite" AS starred
                WHERE starred."projectId" = d."projectId"
            )
        )
    )
)
ON CONFLICT ("id") DO NOTHING;

-- Every widget, placed or not, with its id. A placed one sits on a board the statement above
-- copied, since holding a widget makes a board a Dashboards board.
INSERT INTO "DashboardWidget" (
    "id", "projectId", "dashboardId", "name", "definition", "gridColumn", "gridRow",
    "colSpan", "rowSpan", "createdAt", "updatedAt"
)
SELECT
    g."id", g."projectId", g."dashboardId", g."name", g."graph", g."gridColumn", g."gridRow",
    g."colSpan", g."rowSpan", g."createdAt", g."updatedAt"
FROM "CustomGraph" AS g
WHERE (g."kind" = 'dashboard_srcdoc')
ON CONFLICT ("id") DO NOTHING;
