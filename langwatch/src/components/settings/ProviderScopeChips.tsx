import { Badge, HStack, Text } from "@chakra-ui/react";
import { Building2, Folder, Server, Users } from "lucide-react";

type ScopeEntry = {
  scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
  scopeId: string;
  /**
   * Display name of the scope (organization name, team name, or project
   * name). When omitted the chip falls back to the bare type label —
   * which is what older callers without name access used to render.
   */
  name?: string;
};

/**
 * Renders a horizontal list of scope chips. Each chip shows the
 * scope's icon + name (e.g. "LangWatch", "Acme Team", "web-app").
 * Callers that only have access to the scope type fall back to the
 * bare type label — that's the legacy behaviour for surfaces that
 * haven't been wired up to pass names yet.
 *
 * Bug fixed 2026-05-16: previously rendered "Organization" / "Team" /
 * "Project" with no name even when the caller knew the scope name,
 * producing ambiguous chips like "Team", "Team" when multiple teams
 * were attached to a provider. The shared screenshot from the
 * model-providers drawer proved the issue.
 */
export function ProviderScopeChips({
  scopes,
  fallbackScopeType,
  system,
  size = "sm",
}: {
  scopes?: ScopeEntry[];
  fallbackScopeType?: "ORGANIZATION" | "TEAM" | "PROJECT";
  /**
   * When true and no scopes are attached, render a "System" chip
   * instead of nothing. The caller sets this when it knows the row
   * represents an env-var-fed / built-in provider (no DB row, no
   * scope rows) so the Scope column never reads empty. In-progress
   * drawer / picker states that happen to have no scopes selected
   * yet should NOT pass this — they want the bare empty render.
   */
  system?: boolean;
  size?: "sm" | "xs";
}) {
  const entries: ScopeEntry[] = scopes && scopes.length > 0
    ? scopes
    : fallbackScopeType
      ? [{ scopeType: fallbackScopeType, scopeId: "" }]
      : [];
  const iconSize = size === "xs" ? 10 : 12;
  if (entries.length === 0) {
    if (!system) return null;
    // Matches the "from System" labelling the default-model resolver
    // uses for the same conceptual tier (env-var-fed defaults).
    return (
      <HStack gap={1} wrap="wrap">
        <Badge colorPalette="gray" variant="subtle" size={size}>
          <HStack gap={1}>
            <Server size={iconSize} aria-hidden />
            <Text>System</Text>
          </HStack>
        </Badge>
      </HStack>
    );
  }
  return (
    <HStack gap={1} wrap="wrap">
      {entries.map((entry) => {
        const key = `${entry.scopeType}:${entry.scopeId}`;
        if (entry.scopeType === "ORGANIZATION") {
          return (
            <Badge key={key} colorPalette="blue" variant="subtle" size={size}>
              <HStack gap={1}>
                <Building2 size={iconSize} aria-hidden />
                <Text>{entry.name ?? "Organization"}</Text>
              </HStack>
            </Badge>
          );
        }
        if (entry.scopeType === "TEAM") {
          return (
            <Badge key={key} colorPalette="purple" variant="subtle" size={size}>
              <HStack gap={1}>
                <Users size={iconSize} aria-hidden />
                <Text>{entry.name ?? "Team"}</Text>
              </HStack>
            </Badge>
          );
        }
        return (
          <Badge key={key} colorPalette="gray" variant="subtle" size={size}>
            <HStack gap={1}>
              <Folder size={iconSize} aria-hidden />
              <Text>{entry.name ?? "Project"}</Text>
            </HStack>
          </Badge>
        );
      })}
    </HStack>
  );
}
