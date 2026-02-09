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

// Check if dark mode feature is enabled via build-time env var
const isDarkModeEnabled =
  process.env.NEXT_PUBLIC_FEATURE_DARK_MODE === "true" ||
  process.env.NEXT_PUBLIC_FEATURE_DARK_MODE === "1";

export const ThemeToggle = ({ showLabel = true }: ThemeToggleProps) => {
  const { theme, setTheme } = useTheme();

  const selectedIndex = themeOptions.findIndex((o) => o.value === theme);
  const safeIndex = selectedIndex === -1 ? 0 : selectedIndex;
  const currentOption = themeOptions[safeIndex]!;
  const pillShadow = useColorModeValue(
    "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)",
    "0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.05)",
  );

  if (!isDarkModeEnabled || !currentOption) return null;

  const cycleTheme = () => {
    const nextIndex = (safeIndex + 1) % themeOptions.length;
    setTheme(themeOptions[nextIndex]!.value);
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
          _hover={{ color: "fg.muted", bg: "nav.bgHover" }}
          onClick={cycleTheme}
          aria-label={`Current theme: ${currentOption.value}. Click to change.`}
        >
          {currentOption.icon}
        </HStack>
      </Box>
    );
  }

  // Expanded mode: 3-button selector with animated pill indicator
  return (
    <Box width="full" px={2} py={3}>
      <HStack
        bg="bg.muted"
        borderRadius="lg"
        border="1px solid"
        borderColor="border"
        p="3px"
        gap={0}
        justify="center"
        width="full"
        position="relative"
      >
        {/* Animated background pill */}
        <Box
          position="absolute"
          top="3px"
          bottom="3px"
          left="3px"
          width={`calc((100% - 6px) / ${themeOptions.length})`}
          bg="bg.panel"
          borderRadius="md"
          boxShadow={pillShadow}
          transition="transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)"
          transform={`translateX(${safeIndex * 100}%)`}
          zIndex={0}
        />
        {themeOptions.map((option) => (
          <Box
            key={option.value}
            as="button"
            flex={1}
            display="flex"
            alignItems="center"
            justifyContent="center"
            py="8px"
            px={4}
            borderRadius="md"
            color={theme === option.value ? "fg" : "fg.subtle"}
            cursor="pointer"
            transition="all 0.2s"
            position="relative"
            zIndex={1}
            _hover={{
              color: theme === option.value ? "fg" : "fg.muted",
            }}
            onClick={() => setTheme(option.value)}
            aria-label={`Set theme to ${option.value}`}
          >
            <Box
              transition="transform 0.2s"
              transform={theme === option.value ? "scale(1.1)" : "scale(1)"}
            >
              {option.icon}
            </Box>
          </Box>
        ))}
      </HStack>
    </Box>
  );
};
