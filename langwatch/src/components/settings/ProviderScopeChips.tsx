import { Badge, HStack, Text } from "@chakra-ui/react";
import {
  Boxes,
  Building2,
  Folder,
  KeyRound,
  Server,
  User,
  Users,
  UsersRound,
} from "lucide-react";

import { Link } from "~/components/ui/link";
import { Tooltip } from "~/components/ui/tooltip";

/**
 * Scope kinds a chip can render. ORGANIZATION/TEAM/PROJECT mirror the
 * Prisma `ModelProviderScopeType` enum; DEPARTMENT is a picker/badge-only
 * capability (no enum row - see scope-selector-and-badges.md). GROUP,
 * PRINCIPAL and VIRTUAL_KEY are render-only kinds that gateway budgets
 * target; they are not offered by `ScopeChipPicker`. Surfaces that key on
 * the Prisma enum (model providers) never pass anything but the triad;
 * the tile catalog opts into ORGANIZATION + DEPARTMENT only.
 */
export type ProviderScopeType =
  | "ORGANIZATION"
  | "TEAM"
  | "PROJECT"
  | "DEPARTMENT"
  | "GROUP"
  | "PRINCIPAL"
  | "VIRTUAL_KEY";

type ScopeEntry = {
  scopeType: ProviderScopeType;
  scopeId: string;
  /**
   * Display name of the scope (organization name, team name, project
   * name, department name, group name, person, or virtual key name).
   * When omitted the chip falls back to the bare type label - which is
   * what older callers without name access used to render.
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
};

/**
 * Renders a horizontal list of scope chips. Each chip shows the
 * scope's icon + name (e.g. "LangWatch", "Acme Team", "web-app") with
 * a hover tooltip naming the scope type so the kind is unambiguous
 * even when the icon is small or the row is dense. Callers that only
 * have access to the scope type fall back to the bare type label -
 * that's the legacy behaviour for surfaces that haven't been wired up
 * to pass names yet.
 *
 * For surfaces that render personal-owner state (personal VKs etc.)
 * pass `principal` and an extra "Personal" chip is appended after the
 * scope chips. Personal is orthogonal to scope (a personal VK still
 * has a scope row), so the chip rendering keeps them visually
 * adjacent rather than collapsing one into the other.
 */
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
   * When true and no scopes are attached, render a "System" chip
   * instead of nothing. The caller sets this when it knows the row
   * represents an env-var-fed / built-in provider (no DB row, no
   * scope rows) so the Scope column never reads empty. In-progress
   * drawer / picker states that happen to have no scopes selected
   * yet should NOT pass this - they want the bare empty render.
   */
  system?: boolean;
  /**
   * Personal-owner marker for VKs minted via `langwatch login --device`.
   * Renders an additional "Personal" chip after the scope chips with
   * the owner's display name / email and a "Personal: <owner>" tooltip.
   * Orthogonal to scope - a personal VK still has its own scope row.
   */
  principal?: { name?: string | null; email?: string | null };
  size?: "sm" | "xs";
}) {
  const entries: ScopeEntry[] =
    scopes && scopes.length > 0
      ? scopes
      : fallbackScopeType
        ? [{ scopeType: fallbackScopeType, scopeId: "" }]
        : [];
  const iconSize = size === "xs" ? 10 : 12;
  const principalLabel =
    principal?.name?.trim() || principal?.email?.trim() || undefined;
  if (entries.length === 0 && !principalLabel) {
    if (!system) return null;
    // Matches the "from System" labelling the default-model resolver
    // uses for the same conceptual tier (env-var-fed defaults).
    return (
      <HStack gap={1} wrap="wrap">
        <Tooltip content="Managed by your LangWatch deployment — credentials live in the server environment and every project can use this provider out of the box. No configuration needed.">
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
        const tooltip = entry.detail
          ? `${style.kind}: ${label} · ${entry.detail}`
          : `${style.kind}: ${label}`;
        const chip = (
          <Badge colorPalette={style.colorPalette} variant="subtle" size={size}>
            <HStack gap={1}>
              <Icon size={iconSize} aria-hidden />
              <Text>{label}</Text>
            </HStack>
          </Badge>
        );
        return (
          <Tooltip
            key={`${entry.scopeType}:${entry.scopeId}`}
            content={tooltip}
          >
            {entry.href ? (
              <Link
                href={entry.href}
                variant="plain"
                _hover={{ textDecoration: "underline" }}
              >
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
