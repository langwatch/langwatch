import { Box, HStack } from "@chakra-ui/react";
import { useTheme } from "next-themes";
import { LuMonitor, LuMoon, LuSun } from "react-icons/lu";

import { useColorModeValue } from "./color-mode";

type ThemeOption = "light" | "system" | "dark";

const themeOptions: {
  value: ThemeOption;
  label: string;
  icon: React.ReactNode;
}[] = [
  { value: "light", label: "Light", icon: <LuSun size={13} /> },
  { value: "system", label: "System", icon: <LuMonitor size={13} /> },
  { value: "dark", label: "Dark", icon: <LuMoon size={13} /> },
];

/**
 * Compact light/system/dark segmented control with a sliding pill,
 * sized to sit inline in a menu row (see AccountMenu's theme row).
 */
export const ThemeSwitch = () => {
  const { theme, setTheme } = useTheme();
  const selectedIndex = themeOptions.findIndex((o) => o.value === theme);
  const safeIndex = selectedIndex === -1 ? 1 : selectedIndex;
  const pillShadow = useColorModeValue(
    "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)",
    "0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.05)",
  );

  return (
    <HStack
      role="radiogroup"
      aria-label="Theme"
      position="relative"
      gap={0}
      height="26px"
      width="96px"
      flexShrink={0}
      borderRadius="full"
      bg="bg.muted"
      padding="2px"
    >
      <Box
        aria-hidden
        position="absolute"
        top="2px"
        bottom="2px"
        left="2px"
        width="calc((100% - 4px) / 3)"
        borderRadius="full"
        bg="bg.emphasized"
        boxShadow={pillShadow}
        transition="transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)"
        transform={`translateX(${safeIndex * 100}%)`}
        pointerEvents="none"
      />
      {themeOptions.map((option) => (
        <Box
          key={option.value}
          as="button"
          type="button"
          role="radio"
          aria-checked={theme === option.value}
          aria-label={`Set theme to ${option.label}`}
          flex={1}
          height="full"
          display="flex"
          alignItems="center"
          justifyContent="center"
          position="relative"
          zIndex={1}
          color={theme === option.value ? "fg" : "fg.subtle"}
          cursor="pointer"
          transition="color 0.2s ease"
          _hover={{ color: theme === option.value ? "fg" : "fg.muted" }}
          onClick={() => setTheme(option.value)}
        >
          {option.icon}
        </Box>
      ))}
    </HStack>
  );
};
