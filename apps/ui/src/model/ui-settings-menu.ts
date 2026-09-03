/**
 * The settings navigation, as data — a MODEL, not a component, so "the
 * menu did not lose an entry" is a test. Harvested from `platform/app`'s
 * `SettingsLayout.tsx`; its `DashboardLayout` chrome did NOT travel.
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
 * `showEnterpriseNav` is deliberately not `isEnterprise` — shown while
 * the plan is still loading, so an enterprise reader never watches four
 * links appear a beat after the page.
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
