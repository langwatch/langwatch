/**
 * The settings navigation, as data.
 *
 * Harvested from `platform/app/src/components/SettingsLayout.tsx`, entry for
 * entry and gate for gate. It is a MODEL rather than a component because that
 * is what makes "the menu did not lose an entry" a test rather than a promise:
 * the harvest's whole risk is a silently dropped link, and a list is
 * assertable in a way a tree of JSX is not.
 *
 * WHY apps/ui OWNS IT AT ALL. Every `pages/settings/*` page wrapped
 * `SettingsLayout`, and a feature-web package can own neither: the layout is
 * host chrome shared by twenty-odd settings families, and a package may not
 * import `apps/ui`. So the chrome moves here — a copy, not a repoint — and the
 * frontend feature that serves a settings page wraps its screen in it. The
 * platform copy stays for the pages that have not moved and dies with the last
 * of them.
 *
 * WHAT DID NOT TRAVEL, and both are recorded rather than hidden:
 *
 * - `DashboardLayout`. It is 738 lines of application chrome — the header, the
 *   product menu, the command bar, Langy's dock and the drawer registry — and
 *   it is the same chrome gap every family since the gateway has recorded. This
 *   layout frames the settings content and nothing above it.
 * - The navigation-v2 branch. `SettingsLayout` stands its own menu down when
 *   the v2 shell is active, because that shell carries a richer settings menu
 *   of its own (`features/navigation/useSettingsMenu.ts`). No v2 shell exists
 *   above a page served from here, so this menu always renders — and harvesting
 *   the v2 menu is navigation's move, not this family's.
 */

/** One link in the settings menu. */
export type UiSettingsMenuItem = {
  label: string;
  href: string;
  /**
   * Marks the entry active for every address under this prefix, rather than
   * only for an exact match. Carried over from the platform menu, where four
   * entries own a subtree.
   */
  includePath?: string;
};

/** One collapsible group of settings links. */
export type UiSettingsMenuGroup = {
  label: string;
  /** The address prefixes that open this group on load. */
  paths: string[];
  items: UiSettingsMenuItem[];
};

/** The settings menu: the ungrouped links at the top, then the groups. */
export type UiSettingsMenu = {
  top: UiSettingsMenuItem[];
  groups: UiSettingsMenuGroup[];
};

/**
 * Everything the menu's shape turns on.
 *
 * `showEnterpriseNav` is deliberately not `isEnterprise`: the platform layout
 * shows the enterprise entries while the plan is still loading, so a reader on
 * the enterprise plan never watches four links appear a beat after the page.
 */
export type UiSettingsMenuGates = {
  hasPermission: (permission: string) => boolean;
  isSaaS: boolean;
  showEnterpriseNav: boolean;
  isLiteMember: boolean;
  hasOpsAccess: boolean;
  isOpsAdmin: boolean;
};

export function uiSettingsMenu({
  hasPermission,
  isSaaS,
  showEnterpriseNav,
  isLiteMember,
  hasOpsAccess,
  isOpsAdmin,
}: UiSettingsMenuGates): UiSettingsMenu {
  const enterpriseAndNotLite = showEnterpriseNav && !isLiteMember;
  return {
    top: [
      { label: "General Settings", href: "/settings" },
      ...(isLiteMember ? [] : [{ label: "API Keys", href: "/settings/api-keys" }]),
    ],
    groups: [
      {
        label: "Models",
        paths: ["/settings/model-providers", "/settings/model-costs", "/settings/secrets"],
        items: [
          { label: "Model Providers", href: "/settings/model-providers" },
          { label: "Model Costs", href: "/settings/model-costs" },
          ...(isLiteMember ? [] : [{ label: "Secrets", href: "/settings/secrets" }]),
        ],
      },
      {
        label: "Teams & Access",
        paths: [
          "/settings/teams",
          "/settings/members",
          "/settings/groups",
          "/settings/roles",
          "/settings/role-bindings",
          "/settings/authentication",
          "/settings/scim",
          "/settings/audit-log",
        ],
        items: [
          {
            label: "Members",
            href: "/settings/members",
            includePath: "members",
          },
          { label: "Teams & Projects", href: "/settings/teams" },
          ...(enterpriseAndNotLite
            ? [
                { label: "Groups", href: "/settings/groups" },
                { label: "Roles & Permissions", href: "/settings/roles" },
              ]
            : []),
          { label: "Authentication", href: "/settings/authentication" },
          ...(enterpriseAndNotLite
            ? [
                { label: "SCIM Provisioning", href: "/settings/scim" },
                { label: "Role Bindings", href: "/settings/role-bindings" },
              ]
            : []),
          ...(enterpriseAndNotLite && hasPermission("auditLog:view")
            ? [{ label: "Audit Log", href: "/settings/audit-log" }]
            : []),
        ],
      },
      {
        label: "Features",
        paths: [
          "/settings/annotation-scores",
          "/settings/topic-clustering",
          "/settings/data-retention",
          "/settings/email-suppressions",
          "/settings/integrations",
          "/settings/data-privacy",
        ],
        items: [
          { label: "Data Retention", href: "/settings/data-retention" },
          ...(hasPermission("triggers:view")
            ? [{ label: "Email Suppressions", href: "/settings/email-suppressions" }]
            : []),
          { label: "Data Privacy", href: "/settings/data-privacy" },
          { label: "Annotation Scores", href: "/settings/annotation-scores" },
          ...(isLiteMember
            ? []
            : [{ label: "Topic Clustering", href: "/settings/topic-clustering" }]),
          { label: "Integrations", href: "/settings/integrations" },
        ],
      },
      ...(isLiteMember
        ? []
        : [
            {
              label: "Billing",
              paths: ["/settings/usage", "/settings/subscription", "/settings/license"],
              items: [
                { label: "Usage & Billing", href: "/settings/usage" },
                ...(isSaaS
                  ? [{ label: "Subscription", href: "/settings/subscription" }]
                  : [{ label: "License", href: "/settings/license" }]),
              ],
            },
          ]),
      // The two operator groups are gated on two DIFFERENT grants, decoupled on
      // purpose so that widening operator access can never widen the Backoffice.
      // That decoupling is the ops family's, restated here: `ops:view` opens the
      // workspace and `ops:manage` opens the Backoffice.
      ...(hasOpsAccess
        ? [
            {
              label: "Ops",
              paths: ["/ops"],
              items: [
                { label: "Dashboard", href: "/ops" },
                {
                  label: "Projection Replay",
                  href: "/ops/projections",
                  includePath: "/ops/projections",
                },
                {
                  label: "The Foundry",
                  href: "/ops/foundry",
                  includePath: "/ops/foundry",
                },
                {
                  label: "Payload store",
                  href: "/ops/blobs",
                  includePath: "/ops/blobs",
                },
                {
                  label: "Deja View",
                  href: "/ops/dejaview",
                  includePath: "/ops/dejaview",
                },
                {
                  label: "Feature Flags",
                  href: "/ops/feature-flags",
                  includePath: "/ops/feature-flags",
                },
              ],
            },
          ]
        : []),
      ...(isOpsAdmin
        ? [
            {
              label: "Backoffice",
              paths: ["/ops/backoffice"],
              items: [
                {
                  label: "Users",
                  href: "/ops/backoffice/users",
                  includePath: "/ops/backoffice/users",
                },
                {
                  label: "Organizations",
                  href: "/ops/backoffice/organizations",
                  includePath: "/ops/backoffice/organizations",
                },
                {
                  label: "Projects",
                  href: "/ops/backoffice/projects",
                  includePath: "/ops/backoffice/projects",
                },
                {
                  label: "Subscriptions",
                  href: "/ops/backoffice/subscriptions",
                  includePath: "/ops/backoffice/subscriptions",
                },
                {
                  label: "Bug Reports",
                  href: "/ops/backoffice/bug-reports",
                  includePath: "/ops/backoffice/bug-reports",
                },
              ],
            },
          ]
        : []),
    ],
  };
}

/** Whether one entry is the page on screen. The platform menu's own rule. */
export function isUiSettingsMenuItemActive({
  item,
  pathname,
}: {
  item: UiSettingsMenuItem;
  pathname: string;
}): boolean {
  if (pathname === item.href) return true;
  return item.includePath !== void 0 && pathname.includes(item.includePath);
}

/** Whether a group opens on load, because the page on screen is inside it. */
export function isUiSettingsMenuGroupActive({
  group,
  pathname,
}: {
  group: UiSettingsMenuGroup;
  pathname: string;
}): boolean {
  return group.paths.some((path) => pathname.startsWith(path));
}
