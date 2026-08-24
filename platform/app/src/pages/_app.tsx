/**
 * Theme system definition for LangWatch.
 * This file only exports the Chakra UI `system` — the app shell (providers,
 * routing, NProgress) now lives in src/AppProviders.tsx and src/main.tsx.
 */
import {
  createSystem,
  defaultConfig,
  defineConfig,
  defineRecipe,
  defineSlotRecipe,
  mergeConfigs,
} from "@chakra-ui/react";
import { colorSystem } from "../components/ui/color-mode";
import { frontDoorThemeConfig } from "../features/auth-front-door/frontDoorTheme";
import { langyThemeConfig } from "../features/langy/langyTheme";

// Inter font loaded via CSS @import in globals.scss (no more next/font/google)
const interFontFamily = "'Inter', sans-serif";

/**
 * A restrained hairline in the status colour, mixed into the neutral border
 * rather than drawn on top of it — the same formula as the Langy card's
 * `accentBorder` (`features/asaplangy/tokens.ts`), which exists so a card can
 * carry a tone without wearing a coloured ring.
 */
const statusHairline = (color: string) =>
  `color-mix(in srgb, var(--chakra-colors-${color}) 26%, var(--chakra-colors-border-muted))`;

/**
 * The card material a toast wears in dark mode, whatever its status — the same
 * panel + hairline pair as `INSET` in `features/asaplangy/tokens.ts`. It is
 * repeated per `&[data-type=…]` because that is the shape (and specificity) of
 * Chakra's own filled defaults, which set `bg: red.solid` / `color:
 * red.contrast` and would otherwise survive the deep merge. Light mode keeps
 * those fills.
 */
const toastPanel = {
  bg: "bg.panel",
  color: "fg",
  // Those same filled defaults hand the action trigger a white border and a
  // white hover wash, both of which disappear on a panel.
  "--toast-trigger-bg": "colors.bg.muted",
  "--toast-border-color": "colors.border.muted",
} as const;

const appConfig = defineConfig({
  globalCss: {
    body: {
      background: { _light: "{colors.gray.100}", _dark: "{colors.zinc.900}" },
      fontSize: "14px",
      color: { _light: "{colors.gray.900}", _dark: "{colors.gray.50}" },
    },
    "*::selection": {
      // Chakra by default overrides browser selection color, I really don't like things overriding defaults
      // @ts-expect-error
      bg: null,
    },
    // Chakra's `CodeBlock` paints highlighted lines via an absolutely
    // positioned `::after` pseudo on `[data-line][data-highlight]`,
    // backed by the `--highlight-bg` custom property and a hardcoded
    // gray inline-start border. Override both globally so every code
    // block (env-block in onboarding, pinned attributes in the trace
    // drawer, …) lights up in the LangWatch tracing orange.
    "[data-line][data-highlight], [data-line][data-diff]": {
      "--highlight-bg": "rgba(237, 137, 38, 0.18)",
    },
    "[data-line][data-highlight]::after, [data-line][data-diff]::after": {
      borderInlineStartColor: "#ED8926 !important",
      background:
        "color-mix(in srgb, var(--chakra-colors-orange-emphasized) 20%, transparent) !important",
    },
    // GraphicsQualityProvider sets this attribute when a background FPS
    // probe finds the device can't sustain a smooth frame rate. Recipes
    // below reference `var(--lw-backdrop-blur, blur(Npx))` instead of a
    // literal blur value, so this one variable turns off decorative blur
    // everywhere at once — including static recipes, which can't read
    // React state directly.
    //
    // --lw-panel-alpha goes with it: these surfaces are semi-transparent
    // specifically because the blur diffuses whatever shows through. Turn
    // off the blur alone and the same transparency reads as a plain
    // see-through tint instead of frosted glass — so reduced-graphics mode
    // also pushes every paired background to fully opaque.
    'html[data-reduced-graphics="true"]': {
      "--lw-backdrop-blur": "none",
      "--lw-panel-alpha": "100%",
    },
  },
  theme: {
    tokens: {
      fonts: {
        heading: {
          value: interFontFamily,
        },
        body: {
          value: interFontFamily,
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
            value: { _light: "{colors.gray.200}", _dark: "{colors.zinc.700}" },
          },
          hover: {
            value: { _light: "{colors.gray.300}", _dark: "{colors.zinc.600}" },
          },
          contrast: {
            value: { _light: "{colors.gray.800}", _dark: "{colors.gray.100}" },
          },
          subtle: {
            value: { _light: "{colors.gray.50}", _dark: "{colors.zinc.800}" },
          },
          muted: {
            value: { _light: "{colors.gray.100}", _dark: "{colors.zinc.700}" },
          },
          emphasized: {
            value: { _light: "{colors.gray.400}", _dark: "{colors.zinc.600}" },
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
            value: { _light: "{colors.blue.500}", _dark: "{colors.blue.500}" },
          },
          hover: {
            value: { _light: "{colors.blue.600}", _dark: "{colors.blue.400}" },
          },
          subtle: {
            value: { _light: "{colors.blue.50}", _dark: "{colors.blue.900}" },
          },
          muted: {
            value: { _light: "{colors.blue.100}", _dark: "{colors.blue.800}" },
          },
          emphasized: {
            value: { _light: "{colors.blue.400}", _dark: "{colors.blue.600}" },
          },
          fg: {
            value: { _light: "{colors.blue.700}", _dark: "{colors.blue.300}" },
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
            value: { _light: "{colors.gray.700}", _dark: "{colors.gray.300}" },
          },
          fgMuted: {
            value: { _light: "{colors.gray.600}", _dark: "{colors.gray.400}" },
          },
          bgActive: {
            value: { _light: "{colors.gray.200}", _dark: "{colors.zinc.700}" },
          },
          bgHover: {
            value: { _light: "{colors.gray.200}", _dark: "{colors.zinc.800}" },
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
          // Page/sidebar background
          page: {
            value: { _light: "{colors.gray.100}", _dark: "{colors.zinc.900}" },
          },
          // Main content area - deepest in dark mode
          surface: { value: { _light: "white", _dark: "{colors.zinc.950}" } },
          // Cards and panels - float above surface
          panel: { value: { _light: "white", _dark: "{colors.zinc.800}" } },
          // Muted background for hover states, selections
          muted: {
            value: { _light: "{colors.gray.100}", _dark: "{colors.zinc.850}" },
          },
          // Navigation rail: one step off the page, so the rail reads as
          // its own surface next to the sidebar
          rail: {
            value: { _light: "{colors.gray.150}", _dark: "{colors.zinc.850}" },
          },
          // Emphasized background for active states
          emphasized: {
            value: { _light: "{colors.gray.200}", _dark: "{colors.zinc.600}" },
          },
          // Subtle background for table headers, zebra rows
          subtle: {
            value: { _light: "{colors.gray.50}", _dark: "{colors.zinc.900}" },
          },
          // Softer hover/open lift — sits between subtle and muted, used when
          // bg.muted reads too heavy (e.g. accordion triggers).
          softHover: {
            value: { _light: "{colors.gray.100}", _dark: "{colors.zinc.850}" },
          },
          // Form inputs - sunken below panel in dark
          input: {
            value: { _light: "{colors.gray.200}", _dark: "{colors.zinc.900}" },
          },
          inputHover: {
            value: { _light: "white", _dark: "{colors.zinc.800}" },
          },
        },

        // Foreground semantic tokens - proper contrast in dark mode
        fg: {
          DEFAULT: {
            value: { _light: "{colors.gray.900}", _dark: "{colors.gray.100}" },
          },
          muted: {
            value: { _light: "{colors.gray.600}", _dark: "{colors.gray.300}" },
          },
          subtle: {
            value: { _light: "{colors.gray.500}", _dark: "{colors.gray.400}" },
          },
          inverted: { value: { _light: "white", _dark: "{colors.gray.950}" } },
        },

        // Border semantic tokens - visible in dark mode
        border: {
          DEFAULT: {
            value: { _light: "{colors.gray.200}", _dark: "{colors.zinc.600}" },
          },
          muted: {
            value: { _light: "{colors.gray.100}", _dark: "{colors.zinc.700}" },
          },
          subtle: {
            value: { _light: "{colors.gray.100}", _dark: "{colors.zinc.800}" },
          },
          emphasized: {
            value: { _light: "{colors.gray.300}", _dark: "{colors.zinc.500}" },
          },
        },
      },
    },
    recipes: {
      skeleton: defineRecipe({
        base: {
          "--skeleton-from": "{colors.gray.100}",
          "--skeleton-to": "{colors.gray.200}",
          _dark: {
            "--skeleton-from": "{colors.gray.800}",
            "--skeleton-to": "{colors.gray.700}",
          },
        },
      }),
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
      tooltip: defineSlotRecipe({
        slots: ["content", "arrow", "arrowTip"],
        base: {
          content: {
            bg: "color-mix(in srgb, var(--chakra-colors-bg-panel) var(--lw-panel-alpha, 85%), transparent)",
            backdropFilter: "var(--lw-backdrop-blur, blur(8px))",
            color: "fg",
            border: "1px solid",
            borderColor: "border",
            borderRadius: "md",
            boxShadow: "lg",
            px: "3",
            py: "2",
            textStyle: "xs",
          },
          arrow: {
            "--arrow-background": "colors.bg.panel",
          },
          arrowTip: {
            borderColor: "colors.bg.panel",
          },
        },
      }),
      card: defineSlotRecipe({
        slots: ["root"],
        base: {
          root: {
            borderRadius: "xl",
            transition: "all 0.2s ease-in-out",
            background: "bg.panel",
            // Clip children to the rounded border. Square child paints —
            // table row hover/selection/tints, header bands, code blocks —
            // otherwise overlap the border's curve at the corners. Floating
            // content (menus, tooltips, popovers) renders in portals, so
            // clipping the card never cuts it off.
            overflow: "hidden",
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
            border: "1px solid",
            borderColor: "border",
            borderRadius: "lg",
            boxShadow: "lg",
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
          // Deliberately NO borderRadius and NO background on root. The table
          // is border-collapse: collapse, where border-radius does not apply
          // to internal elements, so a rounded root renders its square
          // header/row/own paints as a clipped-corner artifact; and an opaque
          // root background is a square slab that covers the containing
          // card's rounded BORDER at the corners (cards don't clip their
          // children). Tables inherit their surface; rounding and clipping
          // belong to the container.
          root: {
            background: "transparent",
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
                background: "transparent",
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
                background: "transparent",
                // The final row's cell border doubles up against the
                // container's own bottom edge — drop it.
                "& tbody tr:last-of-type td": { borderBottomWidth: "0" },
              },
              // Chakra's stock line variant paints every row bg="bg" (the PAGE
              // background) — darker than the card surface in dark mode, so
              // the whole body rendered as a mismatched slab. The override must
              // use the same `bg` KEY the stock recipe uses: a `background`
              // key merges alongside `bg` instead of replacing it, and the
              // stock paint wins.
              row: {
                bg: "transparent",
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
                background: "transparent",
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
            background:
              "color-mix(in srgb, var(--chakra-colors-bg-surface) var(--lw-panel-alpha, 60%), transparent)",
            backdropFilter: "var(--lw-backdrop-blur, blur(12px))",
            border: "1px solid",
            borderColor: "border",
            borderRadius: "lg",
            boxShadow: "lg",
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
            background:
              "color-mix(in srgb, var(--chakra-colors-bg-panel) var(--lw-panel-alpha, 75%), transparent)",
            backdropFilter: "var(--lw-backdrop-blur, blur(8px))",
            border: "1px solid",
            borderColor: "border",
            borderRadius: "lg",
            boxShadow: "lg",
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
            border: "1px solid",
            borderColor: "border",
            borderRadius: "lg",
            boxShadow: "lg",
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
            background:
              "color-mix(in srgb, var(--chakra-colors-bg-surface) var(--lw-panel-alpha, 80%), transparent)",
            backdropFilter: "var(--lw-backdrop-blur, blur(25px))",
            border: "1px solid",
            borderColor: "border",
            borderRadius: "lg",
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
      /**
       * Light mode keeps Chakra's own filled toast: a solid status colour with
       * contrast text. On a light page a white card reads as dead, and the
       * status then has nowhere to show but a hairline nobody sees.
       *
       * Dark mode keeps the panel material instead, where a saturated slab is
       * heavy against a dark page: one hairline carries the tone and the status
       * colour is spent on the small icon.
       *
       * The dark rules have to live here rather than as props on
       * `<Toast.Root>`: Chakra's fills are attribute selectors
       * (`&[data-type=error]`), which a style prop cannot outrank, so each one
       * is answered with the same selector under `_dark`.
       * `components/ui/toaster.tsx` renders the icon and the close button.
       */
      toast: defineSlotRecipe({
        slots: ["root", "title", "description"],
        base: {
          root: {
            borderRadius: "xl",
            boxShadow: "lg",
            border: "1px solid",
            borderColor: "border.muted",
            // The icon, the title and the close button share the title's line,
            // so a one-line toast is as tall as its text plus the padding.
            alignItems: "flex-start",
            gap: "2.5",
            paddingBlock: "3",
            // The close button holds 2px of slack around its glyph, so 3 here
            // lands it as far from the right edge as the icon is from the left.
            paddingInlineStart: "3.5",
            paddingInlineEnd: "3",
            // A hairline around a solid fill reads as an outline; the fill is
            // already the edge.
            "&:is([data-type=error], [data-type=warning], [data-type=success])":
              {
                borderColor: "transparent",
              },
            _dark: {
              ...toastPanel,
              backdropFilter: "var(--lw-backdrop-blur, blur(12px))",
              "&[data-type=info]": {
                ...toastPanel,
                borderColor: "border.muted",
              },
              "&[data-type=loading]": {
                ...toastPanel,
                borderColor: "border.muted",
              },
              "&[data-type=error]": {
                ...toastPanel,
                borderColor: statusHairline("red-solid"),
              },
              "&[data-type=warning]": {
                ...toastPanel,
                borderColor: statusHairline("yellow-solid"),
              },
              "&[data-type=success]": {
                ...toastPanel,
                borderColor: statusHairline("green-solid"),
              },
            },
          },
          // Chakra reserves room after the title for a close button it places
          // absolutely. Ours sits in the row, with the row's own gap.
          title: { marginEnd: "0" },
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

/**
 * The app's system, plus Langy's.
 *
 * Langy is a distinct surface inside LangWatch (warm paper, ink, the brand's own
 * ramp) and it carries its own palette — but as a THEME, not a stylesheet of
 * `--chakra-colors-*` overrides. It declares two custom conditions
 * (`_langy` / `_langyDark`, scoped to `.langy-root`) and hangs its values off
 * the SAME semantic tokens the rest of the app uses.
 *
 * `mergeConfigs` is what makes that safe: it deep-merges Langy's condition keys
 * INTO the app's existing token definitions rather than replacing them, so
 * `bg.surface` keeps its `_light` / `_dark` values everywhere and simply gains a
 * `_langy` / `_langyDark` pair that only applies inside the panel. Nothing
 * outside `.langy-root` changes.
 */
export const system = createSystem(
  defaultConfig,
  mergeConfigs(appConfig, langyThemeConfig, frontDoorThemeConfig),
);

// The LangWatch app shell (providers, routing, NProgress) has moved to:
// - src/AppProviders.tsx (provider hierarchy)
// - src/main.tsx (entry point with RouterProvider)
// - src/routes.tsx (route definitions)
