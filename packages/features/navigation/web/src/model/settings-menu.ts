/**
 * The settings navigation, as data.
 *
 * Moved from `platform/app/src/features/navigation/useSettingsMenu.ts`, entry
 * for entry and gate for gate. It arrives as a MODEL rather than a hook: the
 * six readings the hook made for itself all belong to the host, and a menu
 * that fetches its own gates cannot be asserted without a running application.
 * `behavior/use-settings-menu` is the hook that asks the host and calls this.
 *
 * TWO SETTINGS MENUS EXIST AND THAT IS NOT A COPY. `apps/ui`'s
 * `model/ui-settings-menu` is the harvest of `platform/app`'s
 * `SettingsLayout` — the ungrouped, icon-less list the settings PAGES render
 * their own chrome from. This is the shell's: grouped, iconed, carrying the
 * operations and backoffice groups, and read by the sidebar column. The two
 * were separate modules in `platform/app` for the same reason, and the layout
 * there stood its own menu down whenever this one was on screen.
 */

import {
  Activity,
  Anvil,
  Archive,
  BadgeCheck,
  Blocks,
  Brain,
  Bug,
  Building2,
  Coins,
  CreditCard,
  DatabaseZap,
  EyeOff,
  Fingerprint,
  Flag,
  FolderKanban,
  FolderOpen,
  Gauge,
  KeyRound,
  Link2,
  Lock,
  type LucideIcon,
  MailX,
  Network,
  RefreshCw,
  ScrollText,
  Settings2,
  ShieldCheck,
  Sparkles,
  UserCog,
  Users,
  UsersRound,
  Workflow,
} from "lucide-react";
import { isPathUnder } from "./products";

export interface SettingsMenuItem {
  label: string;
  href: string;
  /** Prefix that marks the item active; the href itself when unset. */
  includePath?: string;
  /** Only the exact address marks the item active (group index pages). */
  isExactMatch?: boolean;
  /**
   * Further addresses this entry answers for, matched exactly. Ops keeps
   * a set of old addresses that redirect onto a page another entry owns,
   * and naming them here marks the right entry while the redirect runs
   * and tells the reachability test the address has an owner.
   */
  alsoActiveAt?: string[];
  icon: LucideIcon;
  /** Enterprise-plan entry; renders the quiet grey pill. */
  isEnterprise?: boolean;
}

/**
 * Whether a settings entry is the page on screen.
 *
 * `pathname` is the address in the address bar, never the route pattern the
 * compat router resolves: `/settings/*` is one registered pattern, so every
 * settings page but General and Audit Log reports the same
 * `/settings/[[...path]]` and no entry matched.
 *
 * Spec: specs/navigation/settings-shell-v2.feature
 */
export function isSettingsMenuItemActive({
  item,
  pathname,
}: {
  item: SettingsMenuItem;
  pathname: string;
}): boolean {
  if (item.alsoActiveAt?.includes(pathname)) return true;
  if (item.isExactMatch) return pathname === item.href;
  return isPathUnder({ pathname, base: item.includePath ?? item.href });
}

export interface SettingsMenuGroup {
  /**
   * Identifies the group in the collapse-state storage key, so a copy edit to
   * `label` never drops a reader's open and closed sections. The `settings-`
   * prefix keeps it clear of the product sidebar sections, which share that
   * key space and already claim plain names like `ops`.
   */
  id: string;
  label: string;
  items: SettingsMenuItem[];
}

/**
 * The gates every group builder reads.
 *
 * `hasPermission` takes a plain string rather than `platform/app`'s `Permission`
 * union: the union is declared in that application's server tree, which a
 * governed web package may not import, and every use below is an equality
 * check against a literal this file already spells out.
 */
export interface SettingsMenuGates {
  hasPermission: (permission: string) => boolean;
  isSaaS: boolean;
  showEnterpriseNav: boolean;
  isLiteMember: boolean;
  hasOpsAccess: boolean;
  isPlatformAdmin: boolean;
}

function organizationGroup({
  hasPermission,
  isSaaS,
  showEnterpriseNav,
  isLiteMember,
}: SettingsMenuGates): SettingsMenuGroup {
  return {
    id: "settings-organization",
    label: "Organization",
    items: [
      {
        label: "General",
        href: "/settings",
        isExactMatch: true,
        icon: Settings2,
      },
      // Keys sit here rather than in Access, where four enterprise entries
      // came first and left a page most readers use at the bottom of a group
      // they cannot open.
      ...(!isLiteMember
        ? [{ label: "API Keys", href: "/settings/api-keys", icon: KeyRound }]
        : []),
      {
        label: "Authentication",
        href: "/settings/authentication",
        icon: Fingerprint,
      },
      ...(showEnterpriseNav && !isLiteMember && hasPermission("auditLog:view")
        ? [
            {
              label: "Audit Log",
              href: "/settings/audit-log",
              icon: ScrollText,
              isEnterprise: true,
            },
          ]
        : []),
      ...(!isLiteMember
        ? [{ label: "Usage & Billing", href: "/settings/usage", icon: Gauge }]
        : []),
      ...(!isLiteMember && isSaaS
        ? [
            {
              label: "Subscription",
              href: "/settings/subscription",
              icon: CreditCard,
            },
          ]
        : []),
      ...(!isLiteMember && !isSaaS
        ? [{ label: "License", href: "/settings/license", icon: BadgeCheck }]
        : []),
    ],
  };
}

function accessGroup({
  showEnterpriseNav,
  isLiteMember,
}: SettingsMenuGates): SettingsMenuGroup {
  return {
    id: "settings-access",
    label: "Access",
    items: [
      {
        label: "Members",
        href: "/settings/members",
        includePath: "/settings/members",
        icon: Users,
      },
      {
        label: "Teams & Projects",
        href: "/settings/teams",
        icon: FolderKanban,
      },
      ...(showEnterpriseNav && !isLiteMember ? enterpriseAccessItems() : []),
    ],
  };
}

function enterpriseAccessItems(): SettingsMenuItem[] {
  return [
    {
      label: "Groups",
      href: "/settings/groups",
      icon: UsersRound,
      isEnterprise: true,
    },
    {
      label: "Roles & Permissions",
      href: "/settings/roles",
      icon: ShieldCheck,
      isEnterprise: true,
    },
    {
      label: "Role Bindings",
      href: "/settings/role-bindings",
      icon: Link2,
      isEnterprise: true,
    },
    {
      label: "SCIM Provisioning",
      href: "/settings/scim",
      icon: RefreshCw,
      isEnterprise: true,
    },
  ];
}

function aiInfrastructureGroup({ isLiteMember }: SettingsMenuGates): SettingsMenuGroup {
  return {
    id: "settings-ai-infrastructure",
    label: "AI Infrastructure",
    items: [
      {
        label: "Model Providers",
        href: "/settings/model-providers",
        icon: Brain,
      },
      { label: "Model Costs", href: "/settings/model-costs", icon: Coins },
      ...(!isLiteMember
        ? [{ label: "Secrets", href: "/settings/secrets", icon: Lock }]
        : []),
    ],
  };
}

function dataControlsGroup({ hasPermission }: SettingsMenuGates): SettingsMenuGroup {
  return {
    id: "settings-data-controls",
    label: "Data Controls",
    items: [
      {
        label: "Data Retention",
        href: "/settings/data-retention",
        icon: Archive,
      },
      { label: "Data Privacy", href: "/settings/data-privacy", icon: EyeOff },
      ...(hasPermission("triggers:view")
        ? [
            {
              label: "Email Suppressions",
              href: "/settings/email-suppressions",
              icon: MailX,
            },
          ]
        : []),
    ],
  };
}

function projectGroup({ isLiteMember }: SettingsMenuGates): SettingsMenuGroup {
  return {
    id: "settings-project",
    label: "Project",
    items: [
      {
        label: "Annotation Scores",
        href: "/settings/annotation-scores",
        icon: Sparkles,
      },
      ...(!isLiteMember
        ? [
            {
              label: "Topic Clustering",
              href: "/settings/topic-clustering",
              icon: Network,
            },
          ]
        : []),
      { label: "Integrations", href: "/settings/integrations", icon: Blocks },
    ],
  };
}

/**
 * Every internal ops page, in one list. This is the only place the ops
 * pages are offered in the new navigation modes, so a page missing here
 * cannot be reached from the menu at all. `opsMenuReachability` pins it
 * against the route table.
 *
 * Spec: specs/navigation/ops-navigation-v2.feature
 */
export function opsGroup(): SettingsMenuGroup {
  return {
    id: "settings-ops",
    label: "Ops",
    items: [
      {
        label: "Dashboard",
        href: "/ops",
        isExactMatch: true,
        // The queues address redirects onto the dashboard, which reads
        // the same queues.
        alsoActiveAt: ["/ops/queues"],
        icon: Activity,
      },
      {
        label: "Event Sourcing",
        href: "/ops/event-sourcing",
        // Addresses this workspace owns that do not sit under its prefix.
        // The scheduler one redirects onto the schedules section; the other
        // three are sections of the workspace reached from its own rail —
        // the payload store and Deja View as pages, projection replay as the
        // drawer that address redirects to. Naming them here is what keeps
        // this entry lit while the reader is inside the workspace, and what
        // tells the reachability test the addresses have an owner.
        alsoActiveAt: [
          "/ops/scheduler",
          "/ops/projections",
          "/ops/blobs",
          "/ops/dejaview",
        ],
        icon: Workflow,
      },
      // Projection replay, the payload store and Deja View are not here:
      // all three are event-sourcing tools, and they now live in that
      // workspace's own rail rather than as top-level Ops entries. Replay was
      // already only a drawer opened from the projections section, so its
      // entry here pointed at a redirect.
      { label: "The Foundry", href: "/ops/foundry", icon: Anvil },
      { label: "Feature Flags", href: "/ops/feature-flags", icon: Flag },
      { label: "Migrations", href: "/ops/migrations", icon: DatabaseZap },
    ],
  };
}

export function backofficeGroup(): SettingsMenuGroup {
  return {
    id: "settings-backoffice",
    label: "Backoffice",
    items: [
      {
        label: "Users",
        href: "/ops/backoffice/users",
        // The backoffice root redirects onto the users page.
        alsoActiveAt: ["/ops/backoffice"],
        icon: UserCog,
      },
      {
        label: "Organizations",
        href: "/ops/backoffice/organizations",
        icon: Building2,
      },
      { label: "Projects", href: "/ops/backoffice/projects", icon: FolderOpen },
      {
        label: "Subscriptions",
        href: "/ops/backoffice/subscriptions",
        icon: CreditCard,
      },
      {
        label: "Single Sign-On",
        href: "/ops/backoffice/sso-connections",
        icon: ShieldCheck,
      },
      {
        label: "Bug Reports",
        href: "/ops/backoffice/bug-reports",
        icon: Bug,
      },
    ],
  };
}

/**
 * The settings menu as data for the settings sidebar: grouped, iconed, and
 * filtered by the same gates the legacy settings navigation applied — plan
 * tier, lite membership, permissions, SaaS against self-hosted, operations
 * access. Every page keeps its address.
 *
 * A PURE FUNCTION of its gates rather than the hook it was moved from. The six
 * readings the hook made for itself (the workspace, the public environment,
 * the plan, the lite guard, operations access and the platform-admin check)
 * are all things the host already knows, and a menu that asks for them itself
 * cannot be asserted without a running application.
 *
 * Spec: specs/navigation/settings-shell-v2.feature
 */
export function settingsMenu(gates: SettingsMenuGates): SettingsMenuGroup[] {
  const groups: SettingsMenuGroup[] = [
    organizationGroup(gates),
    accessGroup(gates),
    aiInfrastructureGroup(gates),
    dataControlsGroup(gates),
    projectGroup(gates),
    ...(gates.hasOpsAccess ? [opsGroup()] : []),
    ...(gates.isPlatformAdmin ? [backofficeGroup()] : []),
  ];

  return groups.filter((group) => group.items.length > 0);
}
