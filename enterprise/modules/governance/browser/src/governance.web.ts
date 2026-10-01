/**
 * What a browser installs when it installs governance: the thirteen
 * organization-scoped screens the admin oversight dashboard routes today.
 * Always installed, so nothing here gates itself by tier or flag.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const governanceWeb = defineWebModule("governance")
  .withHosts({
    requires: ["GovernanceHostApi"],
    mounts: {
      GovernanceHostApi: { load: () => import("./behavior/governance-host-mount.tsx") },
    },
  })
  .withScreens({
    "pages/governance/index": {
      path: "/governance",
      label: "Governance",
      load: () => import("./ui/sections/governance/governance-overview.screen.tsx"),
    },
    "pages/governance/inventory.enterprise": {
      path: "/governance/inventory",
      label: "Inventory",
      load: () => import("./ui/sections/governance/governance-inventory.screen.tsx"),
    },
    "pages/governance/ingestion-source-detail.enterprise": {
      path: "/governance/inventory/:id",
      load: () => import("./ui/sections/governance/governance-ingestion-source.screen.tsx"),
    },
    "pages/governance/people": {
      path: "/governance/people",
      label: "People",
      load: () => import("./ui/sections/governance/governance-people.screen.tsx"),
    },
    "pages/governance/agents": {
      path: "/governance/agents",
      label: "Agents",
      load: () => import("./ui/sections/governance/agents.tsx"),
    },
    "pages/governance/costs": {
      path: "/governance/costs",
      label: "Costs",
      load: () => import("./ui/sections/governance/governance-costs.screen.tsx"),
    },
    "pages/governance/billed": {
      path: "/governance/billed",
      label: "Billed",
      load: () => import("./ui/sections/governance/governance-billed.screen.tsx"),
    },
    "pages/governance/insights": {
      path: "/governance/insights",
      label: "Insights",
      load: () => import("./ui/sections/governance/insights.tsx"),
    },
    "pages/governance/analytics": {
      path: "/governance/analytics",
      label: "Analytics",
      load: () => import("./ui/sections/governance/analytics.tsx"),
    },
    "pages/governance/signals": {
      path: "/governance/signals",
      label: "Signals & Alerts",
      load: () => import("./ui/sections/governance/signals.tsx"),
    },
    "pages/governance/teams": {
      path: "/governance/teams",
      label: "Teams",
      load: () => import("./ui/sections/governance/governance-teams.screen.tsx"),
    },
    "pages/governance/teams/[id]": {
      path: "/governance/teams/:id",
      load: () => import("./ui/sections/governance/governance-team.screen.tsx"),
    },
    "pages/governance/users/[id]": {
      path: "/governance/users/:id",
      load: () => import("./ui/sections/governance/governance-user.screen.tsx"),
    },
  });
