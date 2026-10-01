"use client";

import type { IconButtonProps, SpanProps, Tokens } from "@chakra-ui/react";
import { ClientOnly, IconButton, Skeleton, Span } from "@chakra-ui/react";
import { Moon, Sun } from "lucide-react";
import type { ThemeProviderProps } from "next-themes";
import { ThemeProvider, useTheme } from "next-themes";
import * as React from "react";

import { system } from "../system/create-system.ts";
import { colorSystem } from "./color-system.ts";

export { colorSystem };

export type ColorModeProviderProps = ThemeProviderProps;

export function ColorModeProvider(props: ColorModeProviderProps) {
  // When dark mode feature is disabled, force light mode
  // When enabled, use system preference for automatic light/dark switching
  // Chakra v3 uses ".dark &" selector for dark mode, so we need attribute="class"
  return (
    <>
      {/*
        The colour-mode cross-fade is decoration, so a reader who has asked for
        less motion gets the switch without it. Scoped by the media query rather
        than by a hook: the rule then never applies in the first place, instead
        of being applied and then undone on a later render.
      */}
      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          html {
            transition: background-color 0.3s ease, color 0.3s ease;
          }
          html *,
          html *::before,
          html *::after {
            transition: background-color 0.3s ease, border-color 0.3s ease,
              box-shadow 0.3s ease;
          }
        }
      `}</style>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        disableTransitionOnChange={false}
        enableSystem
        enableColorScheme
        themes={["light", "dark", "system"]}
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

const VAR_REFERENCE = /var\((--[\w-]+)\)/g;
const MAX_VAR_DEPTH = 8;

/** Expands every `var(--x)` in `value` through `read`, until only literals remain. */
export function expandCssVars({
  value,
  read,
  depth = 0,
}: {
  value: string;
  read: (name: string) => string;
  depth?: number;
}): string {
  if (depth > MAX_VAR_DEPTH) {
    throw new Error(`Colour variable chain deeper than ${MAX_VAR_DEPTH}: ${value}`);
  }
  return value.replace(VAR_REFERENCE, (_match: string, name: string) => {
    const next = read(name).trim();
    if (!next) {
      throw new Error(`Colour variable ${name} is not defined`);
    }
    return expandCssVars({ value: next, read, depth: depth + 1 });
  });
}

function scaleValue(color: string): string | undefined {
  const [hueName, step] = color.split(".");
  const hue = Object.entries(colorSystem).find(([name]) => name === hueName)?.[1];
  return Object.entries(hue ?? {}).find(([key]) => key === step)?.[1].value;
}

/**
 * The literal colour for a token in the current mode: a scale step from the palette, any other
 * token (`blue.fg`, `chart.3`) from Chakra's stylesheet. Throws on an unknown token, never guesses.
 */
export function getRawColorValue(color: string): string {
  if (color === "white") {
    return "white";
  }
  const scaled = scaleValue(color);
  if (scaled) {
    return scaled;
  }
  const reference = system.token.var(`colors.${color}`);
  const name = /^var\((--[\w-]+)\)$/.exec(reference)?.[1];
  if (!name || typeof document === "undefined") {
    throw new Error(`"${color}" is not a colour token, or there is no document to read it from`);
  }
  // Semantic tokens are declared on descendants of <html>, so read from <body>.
  const style = getComputedStyle(document.body);
  return expandCssVars({
    value: `var(${name})`,
    read: (variable) => style.getPropertyValue(variable),
  });
}

function subscribeToColorMode(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

/** `getRawColorValue`, re-read when the colour mode flips. */
export function useColorRawValue(color: string): string {
  return React.useSyncExternalStore(subscribeToColorMode, () => getRawColorValue(color));
}

export function useColorModeValue<T = Tokens["colors"]>(light: T, dark: T) {
  const { colorMode } = useColorMode();
  return colorMode === "dark" ? dark : light;
}

export function ColorModeIcon() {
  const { colorMode } = useColorMode();
  return colorMode === "dark" ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />;
}

type ColorModeButtonProps = Omit<IconButtonProps, "aria-label">;

export const ColorModeButton = React.forwardRef<HTMLButtonElement, ColorModeButtonProps>(
  function ColorModeButton(props, ref) {
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
  },
);

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

export const DarkMode = React.forwardRef<HTMLSpanElement, SpanProps>(function DarkMode(props, ref) {
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
});
