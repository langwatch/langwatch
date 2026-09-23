import { Badge, HStack, Link, Text } from "@chakra-ui/react";
import { Tooltip } from "@langwatch/design-system/tooltip";
import {
  Boxes,
  Building2,
  Folder,
  KeyRound,
  Server,
  User,
  UserRound,
  Users,
  UsersRound,
} from "lucide-react";

// Scope kinds chip renders; mirrors Prisma enum or picker/badge-only.
export type ProviderScopeType =
  | "ORGANIZATION"
  | "TEAM"
  | "PROJECT"
  | "DEPARTMENT"
  | "GROUP"
  | "PRINCIPAL"
  | "VIRTUAL_KEY"
  | "ATTRIBUTED_USER";

type ScopeEntry = {
  scopeType: ProviderScopeType;
  scopeId: string;
  /**
   * Display name of the scope (organization, team, project, department,
   * group, person, or virtual key). Falls back to the bare type label when
   * omitted - what older callers without name access used to render.
   */
  name?: string;
  /**
   * Appended to the chip's tooltip after the name, for the identifiers
   * and counts that would crowd the visible chip: a slug, a key prefix,
   * a group's member count.
   */
  detail?: string;
  /** Turns the chip into a link to the thing it names. */
  href?: string;
};

const CHIP_STYLES: Record<
  ProviderScopeType,
  {
    icon: typeof Building2;
    colorPalette: string;
    /** Names the kind in the tooltip and stands in for a missing name. */
    kind: string;
    fallbackLabel: string;
  }
> = {
  ORGANIZATION: {
    icon: Building2,
    colorPalette: "blue",
    kind: "Organization",
    fallbackLabel: "Organization",
  },
  TEAM: {
    icon: Users,
    colorPalette: "purple",
    kind: "Team",
    fallbackLabel: "Team",
  },
  PROJECT: {
    icon: Folder,
    colorPalette: "gray",
    kind: "Project",
    fallbackLabel: "Project",
  },
  DEPARTMENT: {
    icon: Boxes,
    colorPalette: "cyan",
    kind: "Department",
    fallbackLabel: "Department",
  },
  GROUP: {
    icon: UsersRound,
    colorPalette: "cyan",
    kind: "Group",
    fallbackLabel: "Group",
  },
  PRINCIPAL: {
    icon: User,
    colorPalette: "teal",
    kind: "Person",
    fallbackLabel: "Person",
  },
  VIRTUAL_KEY: {
    icon: KeyRound,
    colorPalette: "orange",
    kind: "Virtual key",
    fallbackLabel: "Virtual key",
  },
  // The name a chip carries here is the anchor the allowance hangs off, a
  // key or a project, not a person: the limit is handed to each end user
  // the anchor's traffic is attributed to.
  ATTRIBUTED_USER: {
    icon: UserRound,
    colorPalette: "green",
    kind: "Attributed user",
    fallbackLabel: "Attributed user",
  },
};

/**
 * What a chip says on hover: the kind, the target's name, and any detail
 * moved off the visible line. Pure so the composition is assertable
 * without driving a portal-rendered tooltip open.
 */
export function scopeChipTooltip(entry: {
  scopeType: ProviderScopeType;
  name?: string;
  detail?: string;
}): string {
  const style = CHIP_STYLES[entry.scopeType] ?? CHIP_STYLES.PROJECT;
  const label = entry.name ?? style.fallbackLabel;
  return entry.detail ? `${style.kind}: ${label} · ${entry.detail}` : `${style.kind}: ${label}`;
}

function entriesOrFallback({
  scopes,
  fallbackScopeType,
}: {
  scopes: ScopeEntry[] | undefined;
  fallbackScopeType: ProviderScopeType | undefined;
}): ScopeEntry[] {
  if (scopes && scopes.length > 0) return scopes;
  if (fallbackScopeType) return [{ scopeType: fallbackScopeType, scopeId: "" }];
  return [];
}

// Scope chips list; tooltip for scope kind; personal chip orthogonal.
export function ProviderScopeChips({
  scopes,
  fallbackScopeType,
  system,
  principal,
  size = "sm",
}: {
  scopes?: ScopeEntry[];
  fallbackScopeType?: ProviderScopeType;
  /**
   * When true and no scopes are attached, render a "System" chip instead
   * of nothing - for a built-in provider with no DB row. In-progress
   * drawer/picker states with no scopes yet must NOT pass this.
   */
  system?: boolean;
  /**
   * Personal-owner marker for VKs minted via `langwatch login --device`.
   * Renders a "Personal" chip after the scope chips with the owner's
   * name/email. Orthogonal to scope - a personal VK still has its own scope row.
   */
  principal?: { name?: string | null; email?: string | null };
  size?: "sm" | "xs";
}) {
  const entries = entriesOrFallback({ scopes, fallbackScopeType });
  const iconSize = size === "xs" ? 10 : 12;
  const principalLabel = principal?.name?.trim() || principal?.email?.trim() || undefined;
  if (entries.length === 0 && !principalLabel) {
    if (!system) return null;
    // Matches the "from System" labelling the default-model resolver
    // uses for the same conceptual tier (env-var-fed defaults).
    return (
      <HStack gap={1} wrap="wrap">
        <Tooltip content="Managed by your LangWatch deployment: credentials live in the server environment and every project can use this provider out of the box. No configuration needed.">
          <Badge colorPalette="gray" variant="subtle" size={size}>
            <HStack gap={1}>
              <Server size={iconSize} aria-hidden />
              <Text>System</Text>
            </HStack>
          </Badge>
        </Tooltip>
      </HStack>
    );
  }
  return (
    <HStack gap={1} wrap="wrap">
      {entries.map((entry) => {
        const style = CHIP_STYLES[entry.scopeType] ?? CHIP_STYLES.PROJECT;
        const Icon = style.icon;
        const label = entry.name ?? style.fallbackLabel;
        const tooltip = scopeChipTooltip(entry);
        const chip = (
          <Badge colorPalette={style.colorPalette} variant="subtle" size={size}>
            <HStack gap={1}>
              <Icon size={iconSize} aria-hidden />
              <Text>{label}</Text>
            </HStack>
          </Badge>
        );
        return (
          <Tooltip key={`${entry.scopeType}:${entry.scopeId}`} content={tooltip}>
            {entry.href ? (
              <Link href={entry.href} variant="plain" _hover={{ textDecoration: "underline" }}>
                {chip}
              </Link>
            ) : (
              chip
            )}
          </Tooltip>
        );
      })}
      {principalLabel && (
        <Tooltip content={`Personal: ${principalLabel}`}>
          <Badge colorPalette="teal" variant="subtle" size={size}>
            <HStack gap={1}>
              <User size={iconSize} aria-hidden />
              <Text>{principalLabel}</Text>
            </HStack>
          </Badge>
        </Tooltip>
      )}
    </HStack>
  );
}
