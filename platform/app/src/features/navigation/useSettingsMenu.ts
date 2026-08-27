import {
  Activity,
  Anvil,
  Archive,
  BadgeCheck,
  Blocks,
  BookUser,
  Brain,
  Bug,
  Building2,
  Coins,
  CreditCard,
  DatabaseZap,
  EyeOff,
  Fingerprint,
  Flag,
  FolderOpen,
  Gauge,
  KeyRound,
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
  UserRound,
  UserSearch,
  Workflow,
} from "lucide-react";
import { isPathUnder } from "~/features/navigation/products";
import { useActivePlan } from "~/hooks/useActivePlan";
import { useLiteMemberGuard } from "~/hooks/useLiteMemberGuard";
import { useOpsPermission } from "~/hooks/useOpsPermission";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import type { Permission } from "~/server/api/rbac";
import { api } from "~/utils/api";

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

/** The gates every group builder reads. */
interface SettingsMenuGates {
  hasPermission: (permission: Permission) => boolean;
  isSaaS: boolean;
  showEnterpriseNav: boolean;
  isLiteMember: boolean;
}

/**
 * The two pages that are about the reader rather than about the organization
 * they happen to be in, and the reason this group is first.
 *
 * Everything below it is somebody's colleague's business; a name, a photo and
 * a password are nobody's but the reader's. Security in particular used to sit
 * among the roles of other people and the domains an administrator proved,
 * which is the wrong neighbourhood for the one page in Settings a member with
 * no authority at all can still act on.
 *
 * NO GATES. Not the plan, not lite membership, not a permission: a member who
 * may do nothing else here still has a password to change. Anything an
 * ORGANIZATION requires of everybody who signs in lives on Access instead.
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
      // How the ORGANIZATION signs in — a control of the organization itself,
      // beside its keys and its audit trail, not a fact about any one person,
      // which is why it does not sit among the people. The reader's own
      // sign-in is Security, under You.
      //
      // OFFERED TO EVERYONE THIS RELEASE, which is not where it ends up. The
      // entry belongs behind `sso:view` on an enterprise plan, and it goes
      // there in the release that replaces this page — because that page
      // refuses the address as well, and the menu is a courtesy, never the
      // gate. The page here is still the old one, which guards nothing. Gate
      // the menu before the page and the courtesy becomes the gate: an
      // organization signing in through a provider today, on a plan that
      // predates the enterprise flag or administered by somebody holding
      // `admin` rather than `org-admin`, would simply stop being shown where
      // its own sign-in is configured.
      {
        label: "Authentication",
        href: "/settings/authentication",
        icon: Lock,
      },
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
  hasPermission,
  showEnterpriseNav,
  isLiteMember,
}: SettingsMenuGates): SettingsMenuGroup {
  return {
    id: "settings-access",
    // "People & access" rather than "Access": the group holds the people and
    // the rules about them, and a one-word heading made a reader looking for
    // a colleague scan past it.
    label: "People & access",
    items: [
      {
        // Named for what it holds, not for the protocol that fills it. "SCIM"
        // survives in the page's own copy, for the administrator who searches
        // for the protocol by name.
        //
        // ON EVERY PLAN, because this is where the members are. Members,
        // Teams & Projects and Access were three entries answering one
        // question; they are three tabs of this one now, and every old
        // address forwards onto the tab it became. The provisioning tab is
        // the only enterprise part, and it carries its own permission.
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
      ...(showEnterpriseNav && !isLiteMember ? enterpriseAccessItems() : []),
    ],
  };
}

function enterpriseAccessItems(): SettingsMenuItem[] {
  return [
    // Authentication is not here: how the organization signs in is the
    // organization's own control, so it sits in the Organization group beside
    // its keys and its audit log.
    {
      // Definitions and the grants of those definitions are two tabs of one
      // page now; the old Role Bindings address forwards onto the second.
      label: "Roles",
      href: "/settings/roles",
      icon: ShieldCheck,
      alsoActiveAt: ["/settings/role-bindings"],
      isEnterprise: true,
    },
  ];
}

function aiInfrastructureGroup({
  isLiteMember,
}: SettingsMenuGates): SettingsMenuGroup {
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

function dataControlsGroup({
  hasPermission,
}: SettingsMenuGates): SettingsMenuGroup {
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
        label: "Identity Lookup",
        href: "/ops/backoffice/identity-lookup",
        icon: UserSearch,
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
    ],
  };
}

/**
 * The settings menu as data for the navigation-v2 settings sidebar:
 * grouped, iconed, and filtered by the same gates the legacy settings
 * navigation applies (plan tier, lite membership, permissions, SaaS
 * against self-hosted, ops access) — except the YOU group, which is
 * offered to everybody because none of its pages is the organization's.
 *
 * Spec: specs/navigation/settings-shell-v2.feature
 */
export function useSettingsMenu(): SettingsMenuGroup[] {
  const { hasPermission } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const publicEnv = usePublicEnv();
  const { isEnterprise, isLoading: isPlanLoading } = useActivePlan();
  const { isLiteMember } = useLiteMemberGuard();
  const { hasAccess: hasOpsAccess } = useOpsPermission();
  const adminStatus = api.user.isAdmin.useQuery(
    {},
    { enabled: hasOpsAccess, retry: false, refetchOnWindowFocus: false },
  );
  const isAdminUser = adminStatus.data?.isAdmin ?? false;

  const gates: SettingsMenuGates = {
    hasPermission,
    isSaaS: publicEnv.data?.IS_SAAS ?? false,
    showEnterpriseNav: isPlanLoading || isEnterprise,
    isLiteMember,
  };

  const groups: SettingsMenuGroup[] = [
    youGroup(),
    organizationGroup(gates),
    accessGroup(gates),
    aiInfrastructureGroup(gates),
    dataControlsGroup(gates),
    projectGroup(gates),
    ...(hasOpsAccess ? [opsGroup()] : []),
    ...(isAdminUser ? [backofficeGroup()] : []),
  ];

  return groups.filter((group) => group.items.length > 0);
}
