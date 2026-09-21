/**
 * What a browser installs when it installs governance: the fifteen
 * organization-scoped screens the admin oversight dashboard routes today.
 * Always installed, so nothing here gates itself by tier or flag.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

import type { GovernanceSampleCapability, SampleChoice } from "./model/sample-choice.ts";
import { writeSampleChoice } from "./ui/elements/governance-sample-mode.ts";

export const governanceWeb = defineWebModule("governance")
  /**
   * The one thing a peer may do to governance's own state: the guided tour
   * shows the sample panels while it runs and puts them back afterwards. It
   * reads this through its own host api, never by importing governance.
   */
  .withCapabilities({
    setSampleChoice: (choice: SampleChoice): void => {
      writeSampleChoice(choice);
    },
  } satisfies GovernanceSampleCapability)
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
    // origin/main has since folded this address into the inventory's Anomaly
    // rules tab and redirects it; this branch still serves it as its own page.
    // See the handoff's Wire differences before removing it.
    "pages/governance/anomaly-rules.enterprise": {
      path: "/governance/anomaly-rules",
      label: "Anomaly Rules",
      load: () => import("./ui/sections/governance/governance-anomaly-rules.screen.tsx"),
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
    // origin/main has since folded this address into the People page's Users
    // tab and redirects it; this branch still serves it as its own page.
    // See the handoff's Wire differences before removing it.
    "pages/governance/users": {
      path: "/governance/users",
      label: "Users",
      load: () => import("./ui/sections/governance/governance-users.screen.tsx"),
    },
    "pages/governance/users/[id]": {
      path: "/governance/users/:id",
      load: () => import("./ui/sections/governance/governance-user.screen.tsx"),
    },
  });
