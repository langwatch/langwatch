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
  Database,
  EyeOff,
  Fingerprint,
  Flag,
  FolderKanban,
  FolderOpen,
  Gauge,
  History,
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
  icon: LucideIcon;
  /** Enterprise-plan entry; renders the violet pill. */
  isEnterprise?: boolean;
}

export interface SettingsMenuGroup {
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

function organizationGroup({
  hasPermission,
  isSaaS,
  showEnterpriseNav,
  isLiteMember,
}: SettingsMenuGates): SettingsMenuGroup {
  return {
    label: "Organization",
    items: [
      {
        label: "General",
        href: "/settings",
        isExactMatch: true,
        icon: Settings2,
      },
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
      ...(!isLiteMember
        ? [{ label: "API Keys", href: "/settings/api-keys", icon: KeyRound }]
        : []),
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

function aiInfrastructureGroup({
  isLiteMember,
}: SettingsMenuGates): SettingsMenuGroup {
  return {
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

function opsGroup(): SettingsMenuGroup {
  return {
    label: "Ops",
    items: [
      { label: "Dashboard", href: "/ops", isExactMatch: true, icon: Activity },
      {
        label: "Projection Replay",
        href: "/ops/projections",
        icon: Workflow,
      },
      { label: "The Foundry", href: "/ops/foundry", icon: Anvil },
      { label: "Payload store", href: "/ops/blobs", icon: Database },
      { label: "Deja View", href: "/ops/dejaview", icon: History },
      { label: "Feature Flags", href: "/ops/feature-flags", icon: Flag },
    ],
  };
}

function backofficeGroup(): SettingsMenuGroup {
  return {
    label: "Backoffice",
    items: [
      { label: "Users", href: "/ops/backoffice/users", icon: UserCog },
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
 * against self-hosted, ops access). Every page keeps its address.
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
