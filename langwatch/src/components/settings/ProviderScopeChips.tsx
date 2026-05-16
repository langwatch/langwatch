import { Badge, HStack, Text } from "@chakra-ui/react";
import { Building2, Folder, Users } from "lucide-react";

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
  size = "sm",
}: {
  scopes?: ScopeEntry[];
  fallbackScopeType?: "ORGANIZATION" | "TEAM" | "PROJECT";
  size?: "sm" | "xs";
}) {
  const entries: ScopeEntry[] = scopes && scopes.length > 0
    ? scopes
    : fallbackScopeType
      ? [{ scopeType: fallbackScopeType, scopeId: "" }]
      : [];
  if (entries.length === 0) return null;
  const iconSize = size === "xs" ? 10 : 12;
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
