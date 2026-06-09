import { Badge, HStack, Text } from "@chakra-ui/react";
import { Boxes, Building2, Folder, Server, User, Users } from "lucide-react";

import { Tooltip } from "~/components/ui/tooltip";

/**
 * Scope kinds a chip can render. ORGANIZATION/TEAM/PROJECT mirror the
 * Prisma `ModelProviderScopeType` enum; DEPARTMENT is a picker/badge-only
 * capability (no enum row - see scope-selector-and-badges.md). Surfaces
 * that key on the Prisma enum (model providers) never pass DEPARTMENT;
 * the tile catalog opts into ORGANIZATION + DEPARTMENT only.
 */
export type ProviderScopeType =
  | "ORGANIZATION"
  | "TEAM"
  | "PROJECT"
  | "DEPARTMENT";

type ScopeEntry = {
  scopeType: ProviderScopeType;
  scopeId: string;
  /**
   * Display name of the scope (organization name, team name, project
   * name, or department name). When omitted the chip falls back to the
   * bare type label - which is what older callers without name access
   * used to render.
   */
  name?: string;
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
  const entries: ScopeEntry[] = scopes && scopes.length > 0
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
        <Tooltip content="System (built-in or env-var fed)">
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
        const key = `${entry.scopeType}:${entry.scopeId}`;
        if (entry.scopeType === "ORGANIZATION") {
          const label = entry.name ?? "Organization";
          return (
            <Tooltip key={key} content={`Organization: ${label}`}>
              <Badge colorPalette="blue" variant="subtle" size={size}>
                <HStack gap={1}>
                  <Building2 size={iconSize} aria-hidden />
                  <Text>{label}</Text>
                </HStack>
              </Badge>
            </Tooltip>
          );
        }
        if (entry.scopeType === "TEAM") {
          const label = entry.name ?? "Team";
          return (
            <Tooltip key={key} content={`Team: ${label}`}>
              <Badge colorPalette="purple" variant="subtle" size={size}>
                <HStack gap={1}>
                  <Users size={iconSize} aria-hidden />
                  <Text>{label}</Text>
                </HStack>
              </Badge>
            </Tooltip>
          );
        }
        if (entry.scopeType === "DEPARTMENT") {
          const label = entry.name ?? "Department";
          return (
            <Tooltip key={key} content={`Department: ${label}`}>
              <Badge colorPalette="cyan" variant="subtle" size={size}>
                <HStack gap={1}>
                  <Boxes size={iconSize} aria-hidden />
                  <Text>{label}</Text>
                </HStack>
              </Badge>
            </Tooltip>
          );
        }
        const label = entry.name ?? "Project";
        return (
          <Tooltip key={key} content={`Project: ${label}`}>
            <Badge colorPalette="gray" variant="subtle" size={size}>
              <HStack gap={1}>
                <Folder size={iconSize} aria-hidden />
                <Text>{label}</Text>
              </HStack>
            </Badge>
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
