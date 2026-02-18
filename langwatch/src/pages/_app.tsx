import {
  ChakraProvider,
  createSystem,
  defaultConfig,
  defineRecipe,
  defineSlotRecipe,
} from "@chakra-ui/react";
import type { AppType } from "next/app";
import type { Session } from "next-auth";
import { SessionProvider } from "next-auth/react";
import "~/styles/globals.scss";
import "~/styles/markdown.scss";

import { Inter } from "next/font/google";
import Head from "next/head";
import { useRouter } from "next/router";
import NProgress from "nprogress";
import { PostHogProvider } from "posthog-js/react";
import { useEffect, useState } from "react";
import { AnalyticsProvider } from "react-contextual-analytics";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { createAppAnalyticsClient } from "~/utils/analyticsClient";
import { api } from "~/utils/api";
import { ColorModeProvider, colorSystem } from "../components/ui/color-mode";
import { Toaster } from "../components/ui/toaster";
import { usePostHog } from "../hooks/usePostHog";
import { dependencies } from "../injection/dependencies.client";
import { CommandBarProvider } from "../features/command-bar";

const inter = Inter({ subsets: ["latin"] });

export const system = createSystem(defaultConfig, {
  globalCss: {
    body: {
      background: { _light: "{colors.gray.100}", _dark: "{colors.gray.900}" },
      fontSize: "14px",
      color: { _light: "{colors.gray.900}", _dark: "{colors.gray.50}" },
    },
    "*::selection": {
      // Chakra by default overrides browser selection color, I really don't like things overriding defaults
      // @ts-expect-error
      bg: null,
    },
  },
  theme: {
    tokens: {
      fonts: {
        heading: {
          value: inter.style.fontFamily,
        },
        body: {
          value: inter.style.fontFamily,
        },
      },
      colors: colorSystem,
      // TODO: those are not working, we need to manually override cursors below
      cursor: {
        button: {
          value: "pointer",
        },
        menuitem: {
          value: "pointer",
        },
        checkbox: {
          value: "pointer",
        },
        radio: {
          value: "pointer",
        },
        slider: {
          value: "pointer",
        },
        switch: {
          value: "pointer",
        },
        option: {
          value: "pointer",
        },
      },
    },
    semanticTokens: {
      colors: {
        // Palette-specific semantic tokens
        gray: {
          solid: {
            value: { _light: "{colors.gray.200}", _dark: "{colors.gray.700}" },
          },
          hover: {
            value: { _light: "{colors.gray.300}", _dark: "{colors.gray.600}" },
          },
          contrast: {
            value: { _light: "{colors.gray.800}", _dark: "{colors.gray.100}" },
          },
          subtle: {
            value: { _light: "{colors.gray.50}", _dark: "{colors.gray.800}" },
          },
          muted: {
            value: { _light: "{colors.gray.100}", _dark: "{colors.gray.700}" },
          },
          emphasized: {
            value: { _light: "{colors.gray.375}", _dark: "{colors.gray.600}" },
          },
          fg: {
            value: { _light: "{colors.gray.700}", _dark: "{colors.gray.200}" },
          },
          focusRing: { value: "rgb(49, 130, 206)" },
        },
        orange: {
          solid: { value: "#ED8926" },
          hover: {
            value: {
              _light: "{colors.orange.600}",
              _dark: "{colors.orange.500}",
            },
          },
          subtle: {
            value: {
              _light: "{colors.orange.100}",
              _dark: "{colors.orange.900}",
            },
          },
          muted: {
            value: {
              _light: "{colors.orange.100}",
              _dark: "{colors.orange.800}",
            },
          },
          emphasized: {
            value: {
              _light: "{colors.orange.400}",
              _dark: "{colors.orange.700}",
            },
          },
          fg: {
            value: {
              _light: "{colors.orange.800}",
              _dark: "{colors.orange.200}",
            },
          },
          focusRing: { value: "rgb(49, 130, 206)" },
        },
        green: {
          solid: {
            value: {
              _light: "{colors.green.500}",
              _dark: "{colors.green.400}",
            },
          },
          hover: {
            value: {
              _light: "{colors.green.600}",
              _dark: "{colors.green.500}",
            },
          },
          subtle: {
            value: { _light: "{colors.green.50}", _dark: "{colors.green.900}" },
          },
          muted: {
            value: {
              _light: "{colors.green.100}",
              _dark: "{colors.green.800}",
            },
          },
          emphasized: {
            value: {
              _light: "{colors.green.400}",
              _dark: "{colors.green.700}",
            },
          },
          fg: {
            value: {
              _light: "{colors.green.700}",
              _dark: "{colors.green.200}",
            },
          },
          focusRing: { value: "rgb(49, 130, 206)" },
        },
        blue: {
          solid: {
            value: { _light: "{colors.blue.500}", _dark: "{colors.blue.400}" },
          },
          hover: {
            value: { _light: "{colors.blue.600}", _dark: "{colors.blue.500}" },
          },
          subtle: {
            value: { _light: "{colors.blue.50}", _dark: "{colors.blue.900}" },
          },
          muted: {
            value: { _light: "{colors.blue.100}", _dark: "{colors.blue.800}" },
          },
          emphasized: {
            value: { _light: "{colors.blue.400}", _dark: "{colors.blue.700}" },
          },
          fg: {
            value: { _light: "{colors.blue.700}", _dark: "{colors.blue.200}" },
          },
          focusRing: { value: "rgb(49, 130, 206)" },
        },
        yellow: {
          solid: {
            value: {
              _light: "{colors.yellow.500}",
              _dark: "{colors.yellow.400}",
            },
          },
          hover: {
            value: {
              _light: "{colors.yellow.600}",
              _dark: "{colors.yellow.500}",
            },
          },
          subtle: {
            value: {
              _light: "{colors.yellow.50}",
              _dark: "{colors.yellow.900}",
            },
          },
          muted: {
            value: {
              _light: "{colors.yellow.100}",
              _dark: "{colors.yellow.800}",
            },
          },
          emphasized: {
            value: {
              _light: "{colors.yellow.500}",
              _dark: "{colors.yellow.700}",
            },
          },
          fg: {
            value: {
              _light: "{colors.yellow.700}",
              _dark: "{colors.yellow.200}",
            },
          },
          focusRing: { value: "rgb(49, 130, 206)" },
        },
        red: {
          solid: {
            value: { _light: "{colors.red.500}", _dark: "{colors.red.400}" },
          },
          hover: {
            value: { _light: "{colors.red.600}", _dark: "{colors.red.500}" },
          },
          subtle: {
            value: { _light: "{colors.red.50}", _dark: "{colors.red.900}" },
          },
          muted: {
            value: { _light: "{colors.red.100}", _dark: "{colors.red.800}" },
          },
          emphasized: {
            value: { _light: "{colors.red.400}", _dark: "{colors.red.700}" },
          },
          fg: {
            value: { _light: "{colors.red.700}", _dark: "{colors.red.200}" },
          },
          focusRing: { value: "rgb(49, 130, 206)" },
        },
        pink: {
          solid: {
            value: { _light: "{colors.pink.500}", _dark: "{colors.pink.400}" },
          },
          hover: {
            value: { _light: "{colors.pink.600}", _dark: "{colors.pink.500}" },
          },
          subtle: {
            value: { _light: "{colors.pink.50}", _dark: "{colors.pink.900}" },
          },
          muted: {
            value: { _light: "{colors.pink.100}", _dark: "{colors.pink.800}" },
          },
          emphasized: {
            value: { _light: "{colors.pink.500}", _dark: "{colors.pink.700}" },
          },
          fg: {
            value: { _light: "{colors.pink.700}", _dark: "{colors.pink.200}" },
          },
          focusRing: { value: "rgb(49, 130, 206)" },
        },
        purple: {
          solid: {
            value: {
              _light: "{colors.purple.500}",
              _dark: "{colors.purple.400}",
            },
          },
          hover: {
            value: {
              _light: "{colors.purple.600}",
              _dark: "{colors.purple.500}",
            },
          },
          subtle: {
            value: {
              _light: "{colors.purple.50}",
              _dark: "{colors.purple.900}",
            },
          },
          muted: {
            value: {
              _light: "{colors.purple.100}",
              _dark: "{colors.purple.800}",
            },
          },
          emphasized: {
            value: {
              _light: "{colors.purple.400}",
              _dark: "{colors.purple.700}",
            },
          },
          fg: {
            value: {
              _light: "{colors.purple.700}",
              _dark: "{colors.purple.200}",
            },
          },
          focusRing: { value: "rgb(49, 130, 206)" },
        },
        teal: {
          solid: {
            value: { _light: "{colors.teal.500}", _dark: "{colors.teal.400}" },
          },
          hover: {
            value: { _light: "{colors.teal.600}", _dark: "{colors.teal.500}" },
          },
          subtle: {
            value: { _light: "{colors.teal.50}", _dark: "{colors.teal.900}" },
          },
          muted: {
            value: { _light: "{colors.teal.100}", _dark: "{colors.teal.800}" },
          },
          emphasized: {
            value: { _light: "{colors.teal.500}", _dark: "{colors.teal.700}" },
          },
          fg: {
            value: { _light: "{colors.teal.700}", _dark: "{colors.teal.200}" },
          },
          focusRing: { value: "rgb(49, 130, 206)" },
        },
        cyan: {
          solid: {
            value: { _light: "{colors.cyan.500}", _dark: "{colors.cyan.400}" },
          },
          hover: {
            value: { _light: "{colors.cyan.600}", _dark: "{colors.cyan.500}" },
          },
          subtle: {
            value: { _light: "{colors.cyan.50}", _dark: "{colors.cyan.900}" },
          },
          muted: {
            value: { _light: "{colors.cyan.100}", _dark: "{colors.cyan.800}" },
          },
          emphasized: {
            value: { _light: "{colors.cyan.500}", _dark: "{colors.cyan.700}" },
          },
          fg: {
            value: { _light: "{colors.cyan.700}", _dark: "{colors.cyan.200}" },
          },
          focusRing: { value: "rgb(49, 130, 206)" },
        },

        // Status semantic tokens - for evaluation results, pass/fail states, etc.
        status: {
          success: {
            value: {
              _light: "{colors.green.400}",
              _dark: "{colors.green.400}",
            },
          },
          error: {
            value: { _light: "{colors.red.400}", _dark: "{colors.red.400}" },
          },
          warning: {
            value: {
              _light: "{colors.yellow.500}",
              _dark: "{colors.yellow.400}",
            },
          },
          pending: {
            value: {
              _light: "{colors.yellow.500}",
              _dark: "{colors.yellow.400}",
            },
          },
          info: {
            value: { _light: "{colors.blue.400}", _dark: "{colors.blue.400}" },
          },
        },

        // Navigation semantic tokens - for sidebar menu items
        nav: {
          fg: {
            value: { _light: "{colors.gray.700}", _dark: "{colors.gray.200}" },
          },
          fgMuted: {
            value: { _light: "{colors.gray.600}", _dark: "{colors.gray.400}" },
          },
          bgActive: {
            value: { _light: "{colors.gray.200}", _dark: "{colors.gray.700}" },
          },
          bgHover: {
            value: { _light: "{colors.gray.200}", _dark: "{colors.gray.700}" },
          },
        },

        // Label semantic tokens - for form labels, section headers
        label: {
          fg: {
            value: { _light: "{colors.gray.600}", _dark: "{colors.gray.400}" },
          },
          fgMuted: {
            value: { _light: "{colors.gray.500}", _dark: "{colors.gray.500}" },
          },
        },

        // Background semantic tokens - custom light theme, dark theme with inverted hierarchy
        bg: {
          // Page/sidebar background - lighter gray in dark mode
          page: {
            value: { _light: "{colors.gray.100}", _dark: "{colors.gray.900}" },
          },
          // Main content area - darkest in dark mode
          surface: { value: { _light: "white", _dark: "{colors.gray.950}" } },
          // Cards and panels - same as surface (darkest)
          panel: { value: { _light: "white", _dark: "{colors.gray.950}" } },
          // Muted background for hover states, selections
          muted: {
            value: { _light: "{colors.gray.100}", _dark: "{colors.gray.800}" },
          },
          // Emphasized background for active states
          emphasized: {
            value: { _light: "{colors.gray.200}", _dark: "{colors.gray.700}" },
          },
          // Subtle background for table headers, etc.
          subtle: {
            value: { _light: "{colors.gray.50}", _dark: "{colors.gray.900}" },
          },
          // Form inputs
          input: {
            value: { _light: "{colors.gray.200}", _dark: "{colors.gray.800}" },
          },
          inputHover: {
            value: { _light: "white", _dark: "{colors.gray.700}" },
          },
        },

        // Foreground semantic tokens - proper contrast in dark mode
        fg: {
          DEFAULT: {
            value: { _light: "{colors.gray.900}", _dark: "{colors.gray.50}" },
          },
          muted: {
            value: { _light: "{colors.gray.600}", _dark: "{colors.gray.400}" },
          },
          subtle: {
            value: { _light: "{colors.gray.500}", _dark: "{colors.gray.500}" },
          },
          inverted: { value: { _light: "white", _dark: "{colors.gray.900}" } },
        },

        // Border semantic tokens - subtle borders in dark mode
        border: {
          DEFAULT: {
            value: { _light: "{colors.gray.200}", _dark: "{colors.gray.800}" },
          },
          muted: {
            value: { _light: "{colors.gray.100}", _dark: "{colors.gray.800}" },
          },
          subtle: {
            value: { _light: "{colors.gray.100}", _dark: "{colors.gray.900}" },
          },
          emphasized: {
            value: { _light: "{colors.gray.300}", _dark: "{colors.gray.700}" },
          },
        },
      },
      shadows: {
        "2xs": {
          value:
            "0 0 0 0 #000, 0 0 0 0 #000, 0px 1px 2px 0px rgba(0, 0, 0, 0.03)",
        },
        sm: {
          value:
            "1px 1px 2px color-mix(in srgb, var(--chakra-colors-gray-900) 15%, transparent),0px 0px 1px color-mix(in srgb, var(--chakra-colors-gray-900) 30%, transparent)",
        },
        xs: {
          value:
            "0 0 0 0 #000, 0 0 0 0 #000, 0px 1px 5px 0px rgba(0, 0, 0, 0.05)",
        },
      },
    },
    recipes: {
      heading: defineRecipe({
        base: {
          fontWeight: "500",
          color: "fg",
        },
        variants: {
          size: {
            md: { textStyle: "md" },
            lg: { textStyle: "2xl" },
          },
        },
        defaultVariants: {
          size: "md",
        },
      }),
      link: defineRecipe({
        base: {
          focusRing: "none",
        },
      }),
      tag: defineRecipe({
        base: {
          borderRadius: "62px",
          paddingX: 4,
        },
      }),
      button: defineRecipe({
        base: {
          fontWeight: 600,
          borderRadius: "lg",
        },
        variants: {
          variant: {
            solid: {
              _hover: {
                bg: "colorPalette.hover",
              },
            },
            outline: {
              boxShadow: "2xs",
              borderColor: "border.emphasized",
              color: "fg",
              _hover: {
                backgroundColor: "bg.subtle",
                boxShadow: "inset 0 -2px 5px 0px rgba(0, 0, 0, 0.03)",
              },
              _expanded: {
                backgroundColor: "bg.subtle",
              },
            },
            ghost: {
              color: "fg",
              _hover: {
                backgroundColor: "bg.emphasized",
              },
              _expanded: {
                backgroundColor: "bg.emphasized",
              },
            },
          },
          size: {
            xs: {
              h: "6",
              minW: "6",
              textStyle: "xs",
              px: "1.5",
              gap: "1",
              _icon: {
                flexShrink: 0,
                width: "auto",
                height: "auto",
              },
            },
            sm: {
              h: "8",
              minW: "8",
              px: "2.5",
              fontSize: "13px",
              _icon: {
                flexShrink: 1,
                width: "auto",
                height: "auto",
                maxWidth: "16px",
                maxHeight: "16px",
              },
            },
            md: {
              _icon: {
                flexShrink: 1,
                width: "auto",
                height: "auto",
                maxWidth: "20px",
                maxHeight: "20px",
              },
            },
          },
        },
        defaultVariants: {
          size: "sm",
        },
      }),
      separator: defineRecipe({
        variants: {
          orientation: {
            vertical: {
              width: "1px",
              height: "full",
            },
            horizontal: {
              height: "1px",
              width: "full",
            },
          },
        },
      }),
      input: defineRecipe({
        base: {
          borderRadius: "lg",
        },
        variants: {
          variant: {
            outline: {
              bg: "bg.surface/65",
            },
            flushed: {
              borderRadius: "none",
            },
          },
          size: {
            xs: {
              "--input-height": "sizes.7",
            },
            sm: {
              "--input-height": "sizes.8",
            },
          },
        },
      }),
      textarea: defineRecipe({
        base: {
          borderRadius: "md",
        },
        variants: {
          variant: {
            outline: {
              bg: "bg.surface/65",
            },
          },
        },
      }),
      radio: defineRecipe({
        base: {
          backgroundColor: "bg.surface/65",
          "& .dot": {
            backgroundColor: "bg.surface/65",
          },
        },
      }),
      badge: defineRecipe({
        base: {
          borderRadius: "lg",
        },
      }),
    },
    slotRecipes: {
      card: defineSlotRecipe({
        slots: ["root"],
        base: {
          root: {
            borderRadius: "xl",
            transition: "all 0.2s ease-in-out",
            background: "bg.panel",
          },
        },
        variants: {
          variant: {
            outline: {
              root: {
                boxShadow: "2xs",
              },
            },
            elevated: {
              root: {
                border: "1px solid",
                borderColor: "border.muted",
                boxShadow: "md",
                _hover: {
                  boxShadow: "lg",
                },
              },
            },
          },
          size: {
            md: {
              root: {
                "--card-padding": "spacing.5",
              },
            },
          },
        },
        defaultVariants: {
          size: "md",
        },
      }),
      checkbox: defineSlotRecipe({
        slots: ["root", "control", "label"],
        base: {
          control: {
            borderWidth: "1px",
            cursor: "pointer",
            backgroundColor: "bg.surface/65",
          },
          label: {
            fontWeight: "normal",
            cursor: "pointer",
          },
        },
        variants: {
          variant: {
            solid: {
              control: {
                borderColor: "border.emphasized",
                "&:is([data-state=checked], [data-state=indeterminate])": {
                  bg: "blue.500",
                  color: "white",
                  borderColor: "blue.500",
                },
              },
            },
          },
        },
        defaultVariants: {
          // @ts-expect-error
          size: "sm",
        },
      }),
      tabs: defineSlotRecipe({
        slots: ["root", "list", "trigger"],
        base: {
          trigger: {
            height: "auto",
          },
        },
        variants: {
          variant: {
            line: {
              trigger: {
                _selected: {
                  color: "colorPalette.solid",
                },
              },
            },
            subtle: {
              list: {
                borderBottom: "none",
              },
              trigger: {
                borderRadius: "lg",
              },
            },
            enclosed: {
              list: {
                borderRadius: "lg",
                gap: 1,
              },
              trigger: {
                borderRadius: "lg",
                _selected: {
                  boxShadow: "sm",
                },
              },
            },
            outline: {
              root: {
                "--tabs-trigger-radius": "radii.lg",
              },
              list: {
                _horizontal: {
                  _before: {
                    bottom: "1px",
                    left: "0",
                  },
                },
              },
            },
          },
          size: {
            sm: {
              root: {
                "--tabs-height": "sizes.8",
                "--tabs-content-padding": "spacing.3",
              },
              trigger: {
                py: "1",
                px: "3",
                textStyle: "sm",
                fontSize: "13px",
              },
            },
          },
        },
      }),
      menu: defineSlotRecipe({
        slots: ["item", "content"],
        base: {
          content: {
            background: "bg.panel",
          },
          item: {
            cursor: "pointer",
          },
        },
        variants: {
          size: {
            md: {
              item: {
                _icon: {
                  flexShrink: 1,
                  width: "auto",
                  height: "auto",
                  maxWidth: "16px",
                  maxHeight: "16px",
                },
              },
            },
          },
        },
      }),
      table: defineSlotRecipe({
        slots: ["root", "row", "cell", "columnHeader"],
        base: {
          root: {
            borderRadius: "lg",
            background: "bg.panel",
          },
          row: {
            _hover: {
              background: "bg.muted",
            },
          },
          columnHeader: {
            fontWeight: "bold",
            textStyle: "xs",
            textTransform: "uppercase",
            color: "fg.muted",
            letterSpacing: "wider",
          },
        },
        variants: {
          variant: {
            // add grid variant following previous pattern
            grid: {
              root: {
                background: "bg.panel",
              },
              columnHeader: {
                border: "1px solid",
                borderColor: "border",
                background: "bg.subtle",
              },
              cell: {
                border: "1px solid",
                borderColor: "border",
              },
            },
            line: {
              root: {
                background: "bg.panel",
              },
              columnHeader: {
                borderColor: "border",
                background: "bg.subtle",
              },
              cell: {
                borderColor: "border",
              },
            },
            outline: {
              root: {
                background: "bg.panel",
              },
              header: {
                background: "none",
              },
            },
            ghost: {
              root: {
                background: "transparent",
              },
            },
          },
          size: {
            xs: {
              row: {
                lineHeight: "1em",
              },
              columnHeader: {
                fontSize: "11px",
                paddingY: 2,
                paddingX: 3,
              },
              cell: {
                fontSize: "13px",
                paddingY: 2,
                paddingX: 3,
              },
            },
            sm: {
              columnHeader: {
                px: "2",
                py: "2",
              },
              cell: {
                px: "2",
                py: "6px",
              },
            },
          },
        },
        defaultVariants: {
          size: "sm",
        },
      }),
      switch: defineSlotRecipe({
        slots: ["root", "control", "thumb"],
        variants: {
          variant: {
            darkerTrack: {
              control: {
                background: "gray.400",
                _checked: {
                  background: "blue.500",
                },
              },
              thumb: {
                background: "white",
                width: "var(--switch-height)",
                height: "var(--switch-height)",
                scale: "0.8",
                boxShadow: "sm",
                _checked: {
                  background: "white",
                },
              },
            },
          },
        },
      }),
      accordion: defineSlotRecipe({
        slots: ["itemTrigger"],
        base: {
          root: {
            width: "full",
          },
          item: {
            borderRadius: "lg",
          },
          itemTrigger: {
            cursor: "pointer",
            _hover: {
              bg: "bg.subtle",
            },
          },
        },
      }),
      dialog: defineSlotRecipe({
        slots: ["content", "header"],
        base: {
          header: {
            pt: "4",
            pb: "3",
          },
          body: {
            pt: "3",
          },
          title: {
            textStyle: "md",
            fontWeight: "500",
          },
          content: {
            background: "bg.surface/75",
            backdropFilter: "blur(8px)",
            "& button:not([data-variant=ghost]):not([data-part])": {
              boxShadow: "md",
            },
            "& input, & textarea, & select": {
              boxShadow: "xs",
            },
          },
        },
        variants: {
          size: {
            "5xl": {
              content: { maxWidth: "5xl" },
            },
            "6xl": {
              content: { maxWidth: "6xl" },
            },
          },
        },
      }),
      select: defineSlotRecipe({
        slots: ["trigger", "content"],
        base: {
          trigger: {
            cursor: "pointer",
            borderRadius: "lg",
            background: "bg.surface/65",
          },
          content: {
            background: "bg.panel",
            borderRadius: "lg",
          },
          item: {
            borderRadius: "lg",
          },
        },
        variants: {
          size: {
            xs: {
              content: {
                padding: 0,
              },
              item: {
                marginX: 1,
              },
            },
            sm: {
              content: {
                padding: 0,
              },
              item: {
                marginX: 1,
              },
            },
            md: {
              content: {
                padding: 0,
              },
              item: {
                marginX: 2,
              },
            },
            lg: {
              content: {
                padding: 0,
              },
              item: {
                marginX: 2,
              },
            },
          },
        },
      }),
      popover: defineSlotRecipe({
        slots: ["content"],
        base: {
          content: {
            background: "bg.panel",
          },
        },
      }),
      nativeSelect: defineSlotRecipe({
        slots: [],
        variants: {
          variant: {
            outline: {
              field: {
                borderRadius: "lg",
                background: "bg.surface/65",
              },
            },
          },
        },
      }),
      drawer: defineSlotRecipe({
        slots: ["content", "header"],
        base: {
          content: {
            maxWidth: "70%",
            background: "bg.surface",
          },
          header: {
            paddingY: 4,
            paddingRight: 12,
          },
        },
        variants: {
          size: {
            span: { content: { maxWidth: "70%" } },
            full: { content: { maxWidth: "100%" } },
            eval: { content: { maxWidth: "1024px" } },
            xl: { content: { maxWidth: "4xl" } },
          },
        },
        defaultVariants: {
          size: "xl",
        },
      }),
      toast: defineSlotRecipe({
        slots: ["root"],
        base: {
          root: {
            borderRadius: "lg",
            "&[data-type=info]": {
              bg: "blue.solid",
              color: "blue.contrast",
              "--toast-trigger-bg": "{white/10}",
              "--toast-border-color": "{white/40}",
            },
          },
        },
      }),
      progress: defineSlotRecipe({
        slots: ["root", "track", "range"],
        variants: {
          striped: {
            true: {
              range: {
                "--stripe-color": "rgba(255, 255, 255, 0.2)",
              },
            },
          },
        },
      }),
      alert: defineSlotRecipe({
        slots: ["root"],
        base: {
          root: {
            borderRadius: "lg",
          },
        },
      }),
      radioGroup: defineSlotRecipe({
        slots: ["itemControl"],
        base: {
          itemControl: {
            backgroundColor: "bg.surface/65",
          },
        },
      }),
    },
  },
});

let handleChangeStartTimeout: NodeJS.Timeout | null = null;
let nProgressEnabled = false;
setTimeout(() => {
  nProgressEnabled = true;
}, 1000);

const LangWatch: AppType<{
  session: Session | null;
  injected?: string | undefined;
}> = ({ Component, pageProps: { session, ...pageProps } }) => {
  const router = useRouter();
  const postHog = usePostHog();
  const publicEnv = usePublicEnv();

  const [previousFeatureFlagQueryParams, setPreviousFeatureFlagQueryParams] =
    useState<{ key: string; value: string }[]>([]);

  useEffect(() => {
    const featureFlagQueryParams = Object.entries(router.query ?? {})
      .filter(
        ([key]) =>
          key.startsWith("NEXT_PUBLIC_FEATURE_") &&
          typeof router.query[key] === "string",
      )
      .map(([key, value]) => ({ key, value: value as string }));
    setPreviousFeatureFlagQueryParams(featureFlagQueryParams);
  }, [router.query]);

  // Little hack to keep the feature flags on the url the same when navigating to a different page
  const keepSameFeatureFlags = () => {
    if (Object.keys(previousFeatureFlagQueryParams).length > 0) {
      const parsedUrl = new URL(window.location.href);
      let updated = false;
      for (const { key, value } of previousFeatureFlagQueryParams) {
        if (parsedUrl.searchParams.get(key) !== value) {
          parsedUrl.searchParams.set(key, value);
          updated = true;
        }
      }
      if (updated) {
        void router.replace(parsedUrl.toString(), undefined, {
          shallow: true,
        });
      }
    }
  };

  useEffect(() => {
    NProgress.configure({ showSpinner: false });
    const handleChangeDone = () => {
      keepSameFeatureFlags();
      if (handleChangeStartTimeout) {
        clearTimeout(handleChangeStartTimeout);
        handleChangeStartTimeout = null;
      }
      NProgress.done();
    };
    const handleChangeStart_ = () => {
      if (nProgressEnabled && !handleChangeStartTimeout) {
        handleChangeStartTimeout = setTimeout(() => {
          NProgress.start();
          handleChangeStartTimeout = null;
        }, 100);
      }
    };

    router.events.on("routeChangeStart", handleChangeStart_);
    router.events.on("routeChangeComplete", handleChangeDone);
    router.events.on("routeChangeError", handleChangeDone);

    return () => {
      router.events.off("routeChangeStart", handleChangeStart_);
      router.events.off("routeChangeComplete", handleChangeDone);
      router.events.off("routeChangeError", handleChangeDone);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, keepSameFeatureFlags]);

  return (
    <SessionProvider
      session={session}
      refetchInterval={0}
      refetchOnWindowFocus={false}
    >
      <ChakraProvider value={system}>
        <ColorModeProvider>
          <Head>
            <title>LangWatch</title>
          </Head>
          <CommandBarProvider>
            <AnalyticsProvider
              client={createAppAnalyticsClient({
                isSaaS: Boolean(publicEnv.data?.IS_SAAS),
                posthogClient: postHog,
              })}
            >
              {postHog ? (
                <PostHogProvider client={postHog}>
                  <Component {...pageProps} />
                </PostHogProvider>
              ) : (
                <Component {...pageProps} />
              )}
            </AnalyticsProvider>
            <Toaster />
          </CommandBarProvider>

          {dependencies.ExtraFooterComponents && (
            <dependencies.ExtraFooterComponents />
          )}
        </ColorModeProvider>
      </ChakraProvider>
    </SessionProvider>
  );
};

export default api.withTRPC(LangWatch);
