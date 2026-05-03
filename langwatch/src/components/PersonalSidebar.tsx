import { Box, VStack } from "@chakra-ui/react";
import { Gauge, KeyRound } from "lucide-react";
import React, { useState } from "react";
import { useRouter } from "~/utils/compat/next-router";

import { MENU_WIDTH_COMPACT, MENU_WIDTH_EXPANDED } from "./MainMenu";
import { SideMenuLink } from "./sidebar/SideMenuLink";
import { SupportMenu } from "./sidebar/SupportMenu";
import { ThemeToggle } from "./sidebar/ThemeToggle";

/**
 * Personal-scope sidebar rendered by DashboardLayout when
 * `personalScope=true`. Mirrors MainMenu's column shape (compact-on-hover,
 * width math, top-aligned primary nav + bottom-aligned utilities) so the
 * page geometry stays identical between project and personal scopes.
 *
 * Spec: specs/ai-gateway/governance/persona-aware-chrome.feature
 *       — Persona 1 / Persona 2 (personal scope)
 */
export const PersonalSidebar = React.memo(function PersonalSidebar({
  isCompact = false,
}: {
  isCompact?: boolean;
}) {
  const router = useRouter();
  const [isHovered, setIsHovered] = useState(false);

  const showExpanded = !isCompact || isHovered;
  const currentWidth = showExpanded ? MENU_WIDTH_EXPANDED : MENU_WIDTH_COMPACT;

  const isUsageActive = router.pathname === "/me";
  const isSettingsActive = router.pathname.startsWith("/me/settings");

  return (
    <Box
      background="bg.page"
      width={isCompact ? MENU_WIDTH_COMPACT : MENU_WIDTH_EXPANDED}
      minWidth={isCompact ? MENU_WIDTH_COMPACT : MENU_WIDTH_EXPANDED}
      height="calc(100vh - 60px)"
      position="relative"
      onMouseEnter={() => isCompact && setIsHovered(true)}
      onMouseLeave={() => isCompact && setIsHovered(false)}
    >
      <Box
        position={isCompact ? "absolute" : "relative"}
        zIndex={isCompact ? 100 : "auto"}
        top={0}
        left={0}
        width={currentWidth}
        height="calc(100vh - 60px)"
        background="bg.page"
        transition="width 0.15s ease-in-out"
        overflow="hidden"
      >
        <VStack
          paddingX={2}
          paddingTop={2}
          paddingBottom={2}
          gap={0}
          height="100%"
          align="start"
          width={MENU_WIDTH_EXPANDED}
          justifyContent="space-between"
        >
          <VStack width="full" gap={0.5} align="start">
            <SideMenuLink
              icon={Gauge}
              label="My Usage"
              href="/me"
              isActive={isUsageActive}
              showLabel={showExpanded}
            />
            <SideMenuLink
              icon={KeyRound}
              label="Settings"
              href="/me/settings"
              isActive={isSettingsActive}
              showLabel={showExpanded}
            />
          </VStack>

          <VStack width="full" gap={0.5} align="start">
            <SupportMenu showLabel={showExpanded} />
            <ThemeToggle showLabel={showExpanded} />
          </VStack>
        </VStack>
      </Box>
    </Box>
  );
});
