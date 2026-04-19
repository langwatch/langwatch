import { Badge, HStack, Text } from "@chakra-ui/react";
import { Building2, Folder, Users } from "lucide-react";

type ScopeEntry = {
  scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
  scopeId: string;
};

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
                <Text>Organization</Text>
              </HStack>
            </Badge>
          );
        }
        if (entry.scopeType === "TEAM") {
          return (
            <Badge key={key} colorPalette="purple" variant="subtle" size={size}>
              <HStack gap={1}>
                <Users size={iconSize} aria-hidden />
                <Text>Team</Text>
              </HStack>
            </Badge>
          );
        }
        return (
          <Badge key={key} colorPalette="gray" variant="subtle" size={size}>
            <HStack gap={1}>
              <Folder size={iconSize} aria-hidden />
              <Text>Project</Text>
            </HStack>
          </Badge>
        );
      })}
    </HStack>
  );
}
