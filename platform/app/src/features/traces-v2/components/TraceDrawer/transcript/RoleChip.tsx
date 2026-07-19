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

/**
 * Canonical per-role palette. Every chrome surface that renders a role
 * (chip, thread-layout avatar, bubble-layout container, system marker,
 * etc.) sources its colours from here so the same role reads the same
 * across the drawer.
 *
 * Keyed by **display role** (the one users see after scenario role-swap
 * has been applied) so a scenario simulator (`displayRole=assistant`)
 * picks up the same purple the bubble layout uses for assistant cards.
 *
 *  - `fg`     — text + icon colour on the page's neutral surface
 *  - `muted`  — small avatar circle background + accent strips
 *  - `solid`  — saturated background for ChatGPT-style filled avatars
 *  - `contrast` — text/icon colour to use on top of a `solid` fill
 */
export interface RolePalette {
  fg: string;
  muted: string;
  solid: string;
  contrast: string;
}

export const ROLE_PALETTES: Record<string, RolePalette> = {
  system: {
    fg: "fg.muted",
    muted: "bg.subtle",
    solid: "gray.solid",
    contrast: "white",
  },
  user: {
    fg: "blue.fg",
    muted: "blue.muted",
    solid: "blue.solid",
    contrast: "white",
  },
  // Assistant tracks the bubble layout's purple (AssistantTurnCard uses
  // purple.muted/purple.fg). When scenario mode flips a source-user turn
  // into displayRole=assistant ("User Simulator"), this palette gives it
  // the same purple — matching the bubble side instead of drifting to a
  // different colour per layout.
  assistant: {
    fg: "purple.fg",
    muted: "purple.muted",
    solid: "purple.solid",
    contrast: "white",
  },
  tool: {
    fg: "orange.fg",
    muted: "orange.muted",
    solid: "orange.solid",
    contrast: "white",
  },
  developer: {
    fg: "purple.fg",
    muted: "purple.muted",
    solid: "purple.solid",
    contrast: "white",
  },
};

export function getRolePalette(role: string): RolePalette {
  return ROLE_PALETTES[role] ?? ROLE_PALETTES.system!;
}

/**
 * Back-compat shim. New code should consume `ROLE_PALETTES` /
 * `getRolePalette` directly; this object preserves the previous
 * `Record<string, string>` `.fg`-only API for the handful of older
 * sites that aren't worth a full refactor.
 */
export const ROLE_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(ROLE_PALETTES).map(([role, palette]) => [role, palette.fg]),
);

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
  // Key on the *display* role under scenario so the chip carries through
  // the same purple/blue the surrounding bubble/card is using.
  const colorKey = scenarioVisuals?.displayRole ?? role;
  const palette = getRolePalette(colorKey);
  const RoleIcon = scenarioVisuals?.Icon ?? ROLE_ICONS[role];
  return (
    <HStack gap={1} marginBottom={1}>
      {RoleIcon && <Icon as={RoleIcon} boxSize={3} color={palette.fg} />}
      <Text
        textStyle="2xs"
        fontWeight="600"
        color={palette.fg}
        textTransform="uppercase"
        letterSpacing="0.06em"
      >
        {label}
      </Text>
    </HStack>
  );
}
