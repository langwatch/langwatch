/** Settings navigation as data; model not hook, gates belong to host; shell menu, not page menu */

import {
  Activity,
  Anvil,
  Archive,
  BadgeCheck,
  Cloud,
  Blocks,
  Brain,
  Bug,
  Building2,
  Coins,
  CreditCard,
  DatabaseZap,
  EyeOff,
  FileBadge,
  Server,
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
  Stethoscope,
  UserCog,
  Users,
  UsersRound,
  Workflow,
} from "lucide-react";

import { isPathUnder } from "./products.ts";

export interface SettingsMenuItem {
  label: string;
  href: string;
  /** Prefix that marks the item active; the href itself when unset. */
  includePath?: string;
  /** Only the exact address marks the item active (group index pages). */
  isExactMatch?: boolean;
  /**
   * Old addresses that now redirect onto a page another entry owns, named
   * here so the redirect still lights the right entry and the reachability
   * test sees an owner.
   */
  alsoActiveAt?: string[];
  icon: LucideIcon;
  /** Enterprise-plan entry; renders the quiet grey pill. */
  isEnterprise?: boolean;
}

/** Settings entry active check; uses pathname, not router pattern */
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
   * Identifies the group in the collapse-state storage key, so a `label`
   * edit never drops a reader's open/closed state. The `settings-` prefix
   * keeps it clear of the product sidebar, which shares that key space.
   */
  id: string;
  label: string;
  items: SettingsMenuItem[];
}

/**
 * The gates every group builder reads. `hasPermission` takes a plain string,
 * not `platform/app`'s `Permission` union — that union lives in the app's
 * server tree, which a governed web package may not import.
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
      ...(!isLiteMember ? [{ label: "API Keys", href: "/settings/api-keys", icon: KeyRound }] : []),
      // Main's authentication rail: the overview, the identity provider and the connectors.
      {
        label: "Authentication",
        href: "/settings/authentication",
        isExactMatch: true,
        icon: Fingerprint,
      },
      {
        label: "Identity Provider",
        href: "/settings/authentication/provider",
        icon: ShieldCheck,
      },
      {
        label: "Connectors",
        href: "/settings/authentication/connectors",
        icon: Network,
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
        ? [
            { label: "License", href: "/settings/license", icon: BadgeCheck },
            { label: "Connect", href: "/settings/connect", icon: Cloud },
            { label: "Checkup", href: "/settings/checkup", icon: Stethoscope },
          ]
        : []),
    ],
  };
}

function accessGroup({ showEnterpriseNav, isLiteMember }: SettingsMenuGates): SettingsMenuGroup {
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
    id: "settings-ai-members",
    label: "AI Infrastructure",
    items: [
      {
        label: "Model Providers",
        href: "/settings/model-providers",
        icon: Brain,
      },
      { label: "Model Costs", href: "/settings/model-costs", icon: Coins },
      ...(!isLiteMember ? [{ label: "Secrets", href: "/settings/secrets", icon: Lock }] : []),
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
 * The entry the operations attention badge sits on (the legacy sidebar put
 * the same badge on the same link). Named here, not matched in the
 * renderer, so the entry and badge can't drift apart when the address moves.
 */
export const OPS_ATTENTION_HREF = "/ops";

/**
 * Every internal ops page — the only place they're offered in the new
 * navigation, so a page missing here can't be reached from the menu.
 * `opsMenuReachability` pins it against the route table (ops-navigation-v2).
 */
export function opsGroup(): SettingsMenuGroup {
  return {
    id: "settings-ops",
    label: "Ops",
    items: [
      {
        label: "Dashboard",
        href: OPS_ATTENTION_HREF,
        isExactMatch: true,
        // The queues address redirects onto the dashboard, which reads
        // the same queues.
        alsoActiveAt: ["/ops/queues"],
        icon: Activity,
      },
      {
        label: "Event Sourcing",
        href: "/ops/event-sourcing",
        // Addresses this workspace owns outside its own prefix. Naming them
        // here keeps this entry lit while the reader is inside the
        // workspace, and tells the reachability test they have an owner.
        alsoActiveAt: ["/ops/scheduler", "/ops/projections", "/ops/blobs", "/ops/dejaview"],
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
        label: "Directory Sync",
        href: "/ops/backoffice/directory-sync",
        icon: RefreshCw,
      },
      {
        label: "Bug Reports",
        href: "/ops/backoffice/bug-reports",
        icon: Bug,
      },
      {
        label: "Licenses",
        href: "/ops/backoffice/licenses",
        icon: FileBadge,
      },
      {
        label: "Self-hosted Installs",
        href: "/ops/backoffice/self-hosted-instances",
        icon: Server,
      },
    ],
  };
}

/** Settings menu data: grouped, iconed, filtered by gates; pure function of its gates */
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
