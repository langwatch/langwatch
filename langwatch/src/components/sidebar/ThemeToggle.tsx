import { Box, HStack } from "@chakra-ui/react";
import { useTheme } from "next-themes";
import { LuMonitor, LuMoon, LuSun } from "react-icons/lu";
import { useColorModeValue } from "../ui/color-mode";

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
  const pillShadow = useColorModeValue(
    "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)",
    "0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.05)"
  );

  if (!isDarkModeEnabled) return null;

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
        width={showLabel ? "full" : "auto"}
        position="relative"
      >
        {/* Animated background pill */}
        <Box
          position="absolute"
          top="3px"
          bottom="3px"
          left="3px"
          width={`calc((100% - 6px) / 3)`}
          bg="bg.panel"
          borderRadius="md"
          boxShadow={pillShadow}
          transition="transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)"
          transform={`translateX(${selectedIndex * 100}%)`}
          zIndex={0}
        />
        {themeOptions.map((option) => (
          <Box
            key={option.value}
            as="button"
            flex={showLabel ? 1 : undefined}
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
