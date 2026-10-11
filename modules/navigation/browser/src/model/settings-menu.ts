/** Settings navigation as data; model not hook, gates belong to host; shell menu, not page menu */

import type { Hosting } from "@langwatch/browser-host/deployment";
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
  EyeOff,
  Server,
  Fingerprint,
  Flag,
  FolderOpen,
  Gauge,
  KeyRound,
  LogIn,
  MailX,
  Network,
  RefreshCw,
  ScrollText,
  Settings2,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  UserCog,
  UserRound,
  Workflow,
  Vault,
  UserStar,
  ShieldUser,
  FolderSync,
  Receipt,
  Ticket,
  UserSearch,
  BookUser,
  type LucideIcon,
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
  /**
   * An Enterprise entry offered to a plan that lacks it: the sidebar shows a lock and "Included
   * in Enterprise", and the page opens on its upsell.
   */
  isLocked?: boolean;
  /** An Enterprise entry on a plan that includes it: the sidebar marks it with the "ENT" chip. */
  isEnterprise?: boolean;
}

/** Settings entry active check by path prefix; uses pathname, not router pattern */
export function isSettingsMenuItemActive({
  item,
  pathname,
}: {
  item: SettingsMenuItem;
  pathname: string;
}): boolean {
  // By prefix, so a detail page (/settings/teams/:team) keeps its owner lit.
  if (item.alsoActiveAt?.some((base) => isPathUnder({ pathname, base }))) return true;
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
  hasCloudOps: boolean;
  hosting: Hosting;
  /** Enterprise entries: shown, shown locked, or hidden while the plan has not answered. */
  enterprisePlan: EnterprisePlanGate;
  isLiteMember: boolean;
  hasOpsAccess: boolean;
  isPlatformAdmin: boolean;
}

export type EnterprisePlanGate = "included" | "locked" | "pending";

/** A plan still in flight offers no Enterprise entry, so none flickers from locked to open. */
export function enterprisePlanGate({
  isEnterprise,
  isLoading,
}: {
  isEnterprise: boolean;
  isLoading: boolean;
}): EnterprisePlanGate {
  if (isEnterprise) return "included";
  if (isLoading) return "pending";
  return "locked";
}

/** An Enterprise entry under the plan gate; permission and lite-member gates stay the caller's. */
function enterpriseEntry({
  item,
  enterprisePlan,
}: {
  item: SettingsMenuItem;
  enterprisePlan: EnterprisePlanGate;
}): SettingsMenuItem[] {
  if (enterprisePlan === "pending") return [];
  return [
    enterprisePlan === "locked" ? { ...item, isLocked: true } : { ...item, isEnterprise: true },
  ];
}

/**
 * The two pages about the reader, not the organization, which is why this group is first.
 * No gates at all: a member who may do nothing else here still has a password to change.
 */
function youGroup(): SettingsMenuGroup {
  return {
    id: "settings-you",
    label: "You",
    items: [
      { label: "Profile", href: "/settings/profile", icon: UserRound },
      { label: "Security", href: "/settings/security", icon: Fingerprint },
    ],
  };
}

function organizationGroup({
  hasPermission,
  isSaaS,
  enterprisePlan,
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
      ...(!isLiteMember ? [{ label: "API keys", href: "/settings/api-keys", icon: KeyRound }] : []),
      ...(!isLiteMember && hasPermission("auditLog:view")
        ? enterpriseEntry({
            item: { label: "Audit log", href: "/settings/audit-log", icon: ScrollText },
            enterprisePlan,
          })
        : []),
      // How the organization signs in; one entry lit on the provider and connectors pages too.
      // Offered only to a reader who may see single sign-on; the page refuses the address as well.
      // On every plan, never locked: only its single sign-on card needs Enterprise
      // (Alex, 2026-10-11).
      ...(!isLiteMember && hasPermission("sso:view")
        ? [{ label: "Authentication", href: "/settings/authentication", icon: LogIn }]
        : []),
      ...(!isLiteMember
        ? [{ label: "Usage & billing", href: "/settings/usage", icon: Gauge }]
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

function accessGroup({ enterprisePlan, isLiteMember }: SettingsMenuGates): SettingsMenuGroup {
  return {
    id: "settings-access",
    label: "People & access",
    items: [
      {
        // On every plan: members, teams and groups are tabs of this one page,
        // and each old address forwards onto its tab, as on main.
        label: "Directory",
        href: "/settings/directory",
        includePath: "/settings/directory",
        icon: BookUser,
        alsoActiveAt: [
          "/settings/scim",
          "/settings/groups",
          "/settings/members",
          "/settings/teams",
          "/settings/access",
        ],
      },
      ...(!isLiteMember
        ? enterpriseEntry({
            // Definitions and their assignments are two tabs of one page.
            item: {
              label: "Roles & access",
              href: "/settings/roles",
              icon: ShieldCheck,
              alsoActiveAt: ["/settings/role-bindings"],
            },
            enterprisePlan,
          })
        : []),
    ],
  };
}

function aiInfrastructureGroup({ isLiteMember }: SettingsMenuGates): SettingsMenuGroup {
  return {
    id: "settings-ai-infrastructure",
    label: "AI infrastructure",
    items: [
      {
        label: "Model providers",
        href: "/settings/model-providers",
        icon: Brain,
      },
      { label: "Model costs", href: "/settings/model-costs", icon: Coins },
      ...(!isLiteMember ? [{ label: "Secrets", href: "/settings/secrets", icon: Vault }] : []),
    ],
  };
}

function dataControlsGroup({ hasPermission }: SettingsMenuGates): SettingsMenuGroup {
  return {
    id: "settings-data-controls",
    label: "Data controls",
    items: [
      {
        label: "Data retention",
        href: "/settings/data-retention",
        icon: Archive,
      },
      { label: "Data privacy", href: "/settings/data-privacy", icon: EyeOff },
      ...(hasPermission("triggers:view")
        ? [
            {
              label: "Email suppressions",
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
      { label: "General", href: "/settings/project", icon: FolderOpen },
      {
        label: "Annotation scores",
        href: "/settings/annotation-scores",
        icon: Sparkles,
      },
      ...(!isLiteMember
        ? [
            {
              label: "Topic clustering",
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
 * The operator console's health pages; with Tools, Instance and Cloud, every internal ops page.
 * A page missing from adminMenu can't be reached from the menu; `opsMenuReachability` pins
 * it against the route table (ops-navigation-v2).
 */
function healthGroup(): SettingsMenuGroup {
  return {
    id: "admin-health",
    label: "Health",
    items: [
      {
        label: "Dashboard",
        href: OPS_ATTENTION_HREF,
        isExactMatch: true,
        // The queues address redirects onto the dashboard, which reads the same queues.
        alsoActiveAt: ["/ops/queues"],
        icon: Activity,
      },
      {
        label: "Event sourcing",
        href: "/ops/event-sourcing",
        // Addresses this workspace owns outside its own prefix: they keep this entry lit
        // while the reader is inside the workspace, and give the reachability test an owner.
        alsoActiveAt: ["/ops/scheduler", "/ops/projections", "/ops/blobs", "/ops/dejaview"],
        icon: Workflow,
      },
      { label: "Upgrades", href: "/ops/upgrades", icon: RefreshCw },
    ],
  };
}

function toolsGroup({
  hasCloudOps,
  hosting,
}: Pick<SettingsMenuGates, "hasCloudOps" | "hosting">): SettingsMenuGroup {
  return {
    id: "admin-tools",
    label: "Tools",
    items: [
      { label: "Foundry", href: "/ops/foundry", icon: Anvil },
      // The cloud's gradual-rollout switch, also on a developer's machine; never self-hosted.
      ...(hasCloudOps || hosting === "local"
        ? [{ label: "Feature flags", href: "/ops/feature-flags", icon: Flag }]
        : []),
    ],
  };
}

/** Instance administration, for every instance operator, self-hosted included (§3.5). */
export function instanceGroup(): SettingsMenuGroup {
  return {
    id: "admin-instance",
    label: "Instance",
    items: [
      { label: "Operators", href: "/ops/operators", icon: UserStar },
      { label: "Users", href: "/ops/users", icon: UserCog },
      { label: "Organizations", href: "/ops/organizations", icon: Building2 },
      { label: "Projects", href: "/ops/projects", icon: FolderOpen },
      { label: "Single sign-on", href: "/ops/sso-connections", icon: ShieldUser },
      { label: "Identity lookup", href: "/ops/identity-lookup", icon: UserSearch },
      { label: "Directory sync", href: "/ops/directory-sync", icon: FolderSync },
    ],
  };
}

/** LangWatch's own company tooling, offered only on SaaS (ARCHITECTURE.md §3.5). */
export function cloudAdminGroup(): SettingsMenuGroup {
  return {
    id: "admin-cloud",
    label: "Cloud",
    items: [
      { label: "Subscriptions", href: "/ops/cloud/subscriptions", icon: Receipt },
      { label: "Licenses", href: "/ops/cloud/licenses", icon: Ticket },
      { label: "Self-hosted installs", href: "/ops/cloud/self-hosted-instances", icon: Server },
      { label: "Bug reports", href: "/ops/cloud/bug-reports", icon: Bug },
    ],
  };
}

/** Settings menu data: grouped, iconed, filtered by gates; pure function of its gates */
export function settingsMenu(gates: SettingsMenuGates): SettingsMenuGroup[] {
  const groups: SettingsMenuGroup[] = [
    youGroup(),
    organizationGroup(gates),
    accessGroup(gates),
    aiInfrastructureGroup(gates),
    dataControlsGroup(gates),
    projectGroup(gates),
  ];

  return groups.filter((group) => group.items.length > 0);
}

export type AdminMenuGates = Pick<
  SettingsMenuGates,
  "hasCloudOps" | "hosting" | "hasOpsAccess" | "isPlatformAdmin"
>;

/** The operator console's menu (/ops): its own sidebar, never appended to Settings. */
export function adminMenu(gates: AdminMenuGates): SettingsMenuGroup[] {
  const groups: SettingsMenuGroup[] = [
    ...(gates.hasOpsAccess ? [healthGroup(), toolsGroup(gates)] : []),
    ...(gates.isPlatformAdmin ? [instanceGroup()] : []),
    ...(gates.isPlatformAdmin && gates.hasCloudOps ? [cloudAdminGroup()] : []),
  ];

  return groups.filter((group) => group.items.length > 0);
}
