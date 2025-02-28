"use client";

import { useState, useEffect } from "react";
import type { IconButtonProps, SpanProps } from "@chakra-ui/react";
import { ClientOnly, IconButton, Skeleton, Span } from "@chakra-ui/react";
import { ThemeProvider, useTheme } from "next-themes";
import type { ThemeProviderProps } from "next-themes";
import * as React from "react";
import { LuMoon, LuSun } from "react-icons/lu";

export const colorSystem = {
  gray: {
    800: { value: "#090F1D" },
    700: { value: "#1F2937" },
    600: { value: "#213B41" },
    500: { value: "#51676C" },
    400: { value: "#9CA3AF" },
    375: { value: "#B8BDBD" },
    350: { value: "#DDDDDD" },
    300: { value: "#E5E7EB" },
    200: { value: "#E6E9F0" },
    100: { value: "#F2F4F8" },
    50: { value: "#F7FAFC" },
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
    700: { value: "#c05621" },
    600: { value: "#dd6b20" },
    500: { value: "#ED8926" },
    400: { value: "#ED8926" },
    300: { value: "#FF9E2C" },
    200: { value: "#FFD19B" },
    100: { value: "#FFF3E4" },
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

export function ColorModeProvider(props: ColorModeProviderProps) {
  return (
    <ThemeProvider attribute="class" disableTransitionOnChange {...props} />
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

export function getRawColorValue(color: string): string {
  const [colorName, number] = color.split(".");

  if (!colorName || !number) {
    return "pink";
  }

  return (
    colorSystem[colorName as keyof typeof colorSystem][
      (parseInt(
        number
      ) as keyof (typeof colorSystem)[keyof typeof colorSystem]) ?? 0
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
  }
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
  }
);
