import { HStack, Icon, Text } from "@chakra-ui/react";
import type { IconType } from "react-icons";
import { LuBot, LuCode, LuSettings, LuUser, LuWrench } from "react-icons/lu";
import { getDisplayRoleVisuals, useIsScenarioRole } from "../scenarioRoles";

export const ROLE_LABELS: Record<string, string> = {
  system: "SYSTEM",
  user: "USER",
  assistant: "ASSISTANT",
  tool: "TOOL",
  developer: "DEVELOPER",
};

export const ROLE_COLORS: Record<string, string> = {
  system: "fg.muted",
  user: "blue.fg",
  assistant: "green.fg",
  tool: "orange.fg",
  developer: "purple.fg",
};

export const ROLE_ICONS: Record<string, IconType> = {
  system: LuSettings,
  user: LuUser,
  assistant: LuBot,
  tool: LuWrench,
  developer: LuCode,
};

export function RoleChip({ role }: { role: string }) {
  const isScenario = useIsScenarioRole();
  const scenarioVisuals =
    isScenario && (role === "user" || role === "assistant")
      ? getDisplayRoleVisuals(role, { isScenario: true })
      : null;
  const label =
    scenarioVisuals?.label ?? ROLE_LABELS[role] ?? role.toUpperCase();
  // Reuse the existing role palette by keying on the *display* role under
  // scenario, so the swap matches whatever color the bubble/card around it
  // is using.
  const colorKey = scenarioVisuals?.displayRole ?? role;
  const color = ROLE_COLORS[colorKey] ?? "fg.muted";
  const RoleIcon = scenarioVisuals?.Icon ?? ROLE_ICONS[role];
  return (
    <HStack gap={1} marginBottom={1}>
      {RoleIcon && <Icon as={RoleIcon} boxSize={3} color={color} />}
      <Text
        textStyle="2xs"
        fontWeight="600"
        color={color}
        textTransform="uppercase"
        letterSpacing="0.06em"
      >
        {label}
      </Text>
    </HStack>
  );
}
