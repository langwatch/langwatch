"use client";

import type { IconButtonProps, SpanProps } from "@chakra-ui/react";
import { ClientOnly, IconButton, Skeleton, Span } from "@chakra-ui/react";
import type { ThemeProviderProps } from "next-themes";
import { ThemeProvider, useTheme } from "next-themes";
import * as React from "react";
import { LuMoon, LuSun } from "react-icons/lu";

export const colorSystem = {
  // Using Tailwind zinc palette - neutral grays with minimal blue tint
  gray: {
    950: { value: "#09090b" },
    900: { value: "#18181b" },
    800: { value: "#27272a" },
    700: { value: "#3f3f46" },
    600: { value: "#52525b" },
    500: { value: "#71717a" },
    400: { value: "#a1a1aa" },
    375: { value: "#b4b4b4" },
    350: { value: "#d4d4d4" },
    300: { value: "#d4d4d8" },
    200: { value: "#e4e4e7" },
    100: { value: "#f4f4f5" },
    50: { value: "#fafafa" },
  },
  red: {
    50: { value: "#FFF5F5" },
    100: { value: "#FED7D7" },
    200: { value: "#FEB2B2" },
    300: { value: "#FC8181" },
    400: { value: "#F56565" },
    500: { value: "#E53E3E" },
    600: { value: "#C53030" },
    700: { value: "#9B2C2C" },
    800: { value: "#822727" },
    900: { value: "#63171B" },
  },
  orange: {
    50: { value: "#FFFAF0" },
    100: { value: "#FFF3E4" },
    200: { value: "#FFD19B" },
    300: { value: "#FF9E2C" },
    400: { value: "#ED8926" },
    500: { value: "#ED8926" },
    600: { value: "#dd6b20" },
    700: { value: "#c05621" },
    800: { value: "#7B341E" },
    900: { value: "#652B19" },
  },
  yellow: {
    50: { value: "#FFFFF0" },
    100: { value: "#FEFCBF" },
    200: { value: "#FAF089" },
    300: { value: "#F6E05E" },
    400: { value: "#ECC94B" },
    500: { value: "#D69E2E" },
    600: { value: "#B7791F" },
    700: { value: "#975A16" },
    800: { value: "#744210" },
    900: { value: "#5F370E" },
  },
  green: {
    50: { value: "#F0FFF4" },
    100: { value: "#C6F6D5" },
    200: { value: "#9AE6B4" },
    300: { value: "#68D391" },
    400: { value: "#48BB78" },
    500: { value: "#38A169" },
    600: { value: "#2F855A" },
    700: { value: "#276749" },
    800: { value: "#22543D" },
    900: { value: "#1C4532" },
  },
  teal: {
    50: { value: "#E6FFFA" },
    100: { value: "#B2F5EA" },
    200: { value: "#81E6D9" },
    300: { value: "#4FD1C5" },
    400: { value: "#38B2AC" },
    500: { value: "#319795" },
    600: { value: "#2C7A7B" },
    700: { value: "#285E61" },
    800: { value: "#234E52" },
    900: { value: "#1D4044" },
  },
  blue: {
    50: { value: "#ebf8ff" },
    100: { value: "#bee3f8" },
    200: { value: "#90cdf4" },
    300: { value: "#63b3ed" },
    400: { value: "#4299e1" },
    500: { value: "#3182ce" },
    600: { value: "#2b6cb0" },
    700: { value: "#2c5282" },
    800: { value: "#2a4365" },
    900: { value: "#1A365D" },
  },
  cyan: {
    50: { value: "#EDFDFD" },
    100: { value: "#C4F1F9" },
    200: { value: "#9DECF9" },
    300: { value: "#76E4F7" },
    400: { value: "#0BC5EA" },
    500: { value: "#00B5D8" },
    600: { value: "#00A3C4" },
    700: { value: "#0987A0" },
    800: { value: "#086F83" },
    900: { value: "#065666" },
  },
  purple: {
    50: { value: "#FAF5FF" },
    100: { value: "#E9D8FD" },
    200: { value: "#D6BCFA" },
    300: { value: "#B794F4" },
    400: { value: "#9F7AEA" },
    500: { value: "#805AD5" },
    600: { value: "#6B46C1" },
    700: { value: "#553C9A" },
    800: { value: "#44337A" },
    900: { value: "#322659" },
  },
  pink: {
    50: { value: "#FFF5F7" },
    100: { value: "#FED7E2" },
    200: { value: "#FBB6CE" },
    300: { value: "#F687B3" },
    400: { value: "#ED64A6" },
    500: { value: "#D53F8C" },
    600: { value: "#B83280" },
    700: { value: "#97266D" },
    800: { value: "#702459" },
    900: { value: "#521B41" },
  },
};

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface ColorModeProviderProps extends ThemeProviderProps {}

// Check if dark mode feature is enabled via build-time env var
const isDarkModeEnabled =
  process.env.NEXT_PUBLIC_FEATURE_DARK_MODE === "true" ||
  process.env.NEXT_PUBLIC_FEATURE_DARK_MODE === "1";

export function ColorModeProvider(props: ColorModeProviderProps) {
  // When dark mode feature is disabled, force light mode
  // When enabled, use system preference for automatic light/dark switching
  // Chakra v3 uses ".dark &" selector for dark mode, so we need attribute="class"
  return (
    <>
      <style jsx global>{`
        html {
          transition: background-color 0.3s ease, color 0.3s ease;
        }
        html *,
        html *::before,
        html *::after {
          transition: background-color 0.3s ease, border-color 0.3s ease,
            box-shadow 0.3s ease;
        }
      `}</style>
      <ThemeProvider
        attribute="class"
        defaultTheme={isDarkModeEnabled ? "system" : "light"}
        disableTransitionOnChange={false}
        enableSystem={isDarkModeEnabled}
        enableColorScheme={isDarkModeEnabled}
        forcedTheme={isDarkModeEnabled ? undefined : "light"}
        themes={isDarkModeEnabled ? ["light", "dark", "system"] : ["light"]}
        {...props}
      />
    </>
  );
}

export type ColorMode = "light" | "dark";

export interface UseColorModeReturn {
  colorMode: ColorMode;
  setColorMode: (colorMode: ColorMode) => void;
  toggleColorMode: () => void;
}

export function useColorMode(): UseColorModeReturn {
  const { resolvedTheme, setTheme } = useTheme();
  const toggleColorMode = () => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  };
  return {
    colorMode: resolvedTheme as ColorMode,
    setColorMode: setTheme,
    toggleColorMode,
  };
}

// Mapping for semantic token names to numeric color values
// Used to resolve tokens like "blue.fg" to actual hex colors
const semanticToNumeric: Record<string, number> = {
  fg: 600,
  solid: 500,
  subtle: 100,
  muted: 200,
  emphasized: 300,
  contrast: 900,
  hover: 600,
};

export function getRawColorValue(color: string): string {
  if (color === "white") {
    return "white";
  }

  const [colorName, numberOrToken] = color.split(".");

  if (!colorName || !numberOrToken) {
    return "pink";
  }

  // Try parsing as number first, then check semantic token mapping
  let numericValue = parseInt(numberOrToken, 10);
  if (isNaN(numericValue)) {
    numericValue = semanticToNumeric[numberOrToken] ?? 500;
  }

  return (
    colorSystem[colorName as keyof typeof colorSystem]?.[
      numericValue as keyof (typeof colorSystem)[keyof typeof colorSystem]
    ]?.value ?? "pink"
  );
}

export function useColorRawValue(variable: string): string {
  return getRawColorValue(variable);
}

export function useColorModeValue<T>(light: T, dark: T) {
  const { colorMode } = useColorMode();
  return colorMode === "dark" ? dark : light;
}

export function ColorModeIcon() {
  const { colorMode } = useColorMode();
  return colorMode === "dark" ? <LuMoon /> : <LuSun />;
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface ColorModeButtonProps extends Omit<IconButtonProps, "aria-label"> {}

export const ColorModeButton = React.forwardRef<
  HTMLButtonElement,
  ColorModeButtonProps
>(function ColorModeButton(props, ref) {
  const { toggleColorMode } = useColorMode();
  return (
    <ClientOnly fallback={<Skeleton boxSize="8" />}>
      <IconButton
        onClick={toggleColorMode}
        variant="ghost"
        aria-label="Toggle color mode"
        size="sm"
        ref={ref}
        {...props}
        css={{
          _icon: {
            width: "5",
            height: "5",
          },
        }}
      >
        <ColorModeIcon />
      </IconButton>
    </ClientOnly>
  );
});

export const LightMode = React.forwardRef<HTMLSpanElement, SpanProps>(
  function LightMode(props, ref) {
    return (
      <Span
        color="fg"
        display="contents"
        className="chakra-theme light"
        colorPalette="light"
        ref={ref}
        {...props}
      />
    );
  },
);

export const DarkMode = React.forwardRef<HTMLSpanElement, SpanProps>(
  function DarkMode(props, ref) {
    return (
      <Span
        color="fg"
        display="contents"
        className="chakra-theme dark"
        colorPalette="dark"
        ref={ref}
        {...props}
      />
    );
  },
);
