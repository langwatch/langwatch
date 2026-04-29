import { Box, HStack } from "@chakra-ui/react";
import { useTheme } from "next-themes";
import { LuMonitor, LuMoon, LuSun } from "react-icons/lu";
import { useColorModeValue } from "../ui/color-mode";
import { MENU_ITEM_HEIGHT } from "./SideMenuLink";

export type ThemeToggleProps = {
  showLabel?: boolean;
};

type ThemeOption = "system" | "light" | "dark";

const themeOptions: { value: ThemeOption; icon: React.ReactNode }[] = [
  { value: "light", icon: <LuSun size={15} /> },
  { value: "system", icon: <LuMonitor size={15} /> },
  { value: "dark", icon: <LuMoon size={15} /> },
];

export const ThemeToggle = ({ showLabel = true }: ThemeToggleProps) => {
  const { theme, setTheme } = useTheme();

  const selectedIndex = themeOptions.findIndex((o) => o.value === theme);
  const safeIndex = selectedIndex === -1 ? 0 : selectedIndex;
  const currentOption = themeOptions[safeIndex];
  const pillShadow = useColorModeValue(
    "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)",
    "0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.05)",
  );

  if (!currentOption) return null;

  const cycleTheme = () => {
    const nextIndex = (safeIndex + 1) % themeOptions.length;
    const nextOption = themeOptions[nextIndex];
    if (!nextOption) return;
    setTheme(nextOption.value);
  };

  // Collapsed mode: single icon that cycles through themes on click
  if (!showLabel) {
    return (
      <Box width="full" py={1}>
        <HStack
          as="button"
          width="auto"
          height={MENU_ITEM_HEIGHT}
          paddingX={3}
          borderRadius="lg"
          bg="bg.muted"
          border="1px solid"
          borderColor="border"
          color="fg.subtle"
          cursor="pointer"
          transition="all 0.15s ease-in-out"
          _hover={{ color: "fg.muted", backgroundColor: "nav.bgHover" }}
          onClick={cycleTheme}
          aria-label={`Current theme: ${currentOption.value}. Click to change.`}
        >
          {currentOption.icon}
        </HStack>
      </Box>
    );
  }

  // Expanded mode: three icons spread across the row with a soft circle that
  // slides behind the active one. No bordered container, no shared chrome.
  return (
    <Box width="full" px={2} py={3}>
      <HStack
        role="radiogroup"
        aria-label="Theme"
        justify="space-between"
        width="full"
        position="relative"
        height="32px"
      >
        {/* Soft sliding indicator. Width is one-third of the row, so the icon
            it sits under stays centred as it animates between positions. */}
        <Box
          position="absolute"
          top="50%"
          left={0}
          width={`calc(100% / ${themeOptions.length})`}
          height="32px"
          marginTop="-16px"
          borderRadius="full"
          bg="bg.emphasized"
          boxShadow={pillShadow}
          transition="transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)"
          transform={`translateX(${safeIndex * 100}%)`}
          pointerEvents="none"
        />
        {themeOptions.map((option) => (
          <Box
            key={option.value}
            as="button"
            role="radio"
            aria-checked={theme === option.value}
            aria-label={`Set theme to ${option.value}`}
            flex={1}
            display="flex"
            alignItems="center"
            justifyContent="center"
            height="full"
            color={theme === option.value ? "fg" : "fg.subtle"}
            cursor="pointer"
            transition="color 0.2s ease"
            position="relative"
            _hover={{ color: theme === option.value ? "fg" : "fg.muted" }}
            onClick={() => setTheme(option.value)}
          >
            <Box
              transition="transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)"
              transform={theme === option.value ? "scale(1.15)" : "scale(1)"}
            >
              {option.icon}
            </Box>
          </Box>
        ))}
      </HStack>
    </Box>
  );
};
