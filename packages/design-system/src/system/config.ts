/**
 * Theme system definition for LangWatch.
 * This file only exports the Chakra UI `system` — the app shell (providers,
 * routing, NProgress) lives in `@langwatch/ui`'s `ui/sections`.
 */
import { defineConfig, defineRecipe, defineSlotRecipe } from "@chakra-ui/react";

import { colorSystem } from "../color-mode/color-system.ts";
import { alertSlotRecipe, deepeningMesh, statusMesh } from "./alert.recipe.ts";
import { drawerSlotRecipe } from "./drawer.recipe.ts";
import { optionItemRecipe, optionListContent, optionListSizes } from "./option-list.recipe.ts";
import { PRODUCT_COLOURS, productColourTokens } from "./product-colours.ts";
import { sectionNavigationRailRecipe } from "./section-navigation.recipe.ts";
import { segmentGroupSlotRecipe } from "./segment-group.recipe.ts";
import { productTextStyles, takeoverTextStyles } from "./text-styles.ts";

// Inter and JetBrains Mono are loaded by the CSS @import in the application's
// globals.scss. This file names the families, it does not fetch them.
const interFontFamily = "'Inter', sans-serif";

/** The site's display serif, self-hosted (apps/ui globals.scss): Langy's voice and the front
 * door. */
const displayFontFamily = '"Sentient", ui-serif, Georgia, "Times New Roman", serif';

/** The face the product's small technical lines are set in. */
const monoFontFamily =
  '"JetBrains Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

const TOAST_SPRING =
  "linear(0, 0.013 0.6%, 0.05 1.2%, 0.2 2.6%, 0.48 4.7%, 0.76 7.2%, 0.91 9.6%, 1.006 12.4%, 1.043 15.2%, 1.048 17.5%, 1.036 20.6%, 1.012 26.6%, 0.998 34.2%, 0.997 41.1%, 1 56.3%, 1)";

/** The card a toast wears: the panel, its hairline and the ordinary foreground. */
const toastPanel = {
  bg: "bg.panel",
  color: "fg",
  borderColor: "border.muted",
  // Those same filled defaults hand the action trigger a white border and a
  // white hover wash, both of which disappear on a panel.
  "--toast-trigger-bg": "colors.bg.muted",
  "--toast-border-color": "colors.border.muted",
} as const;

/** A status toast: the panel, in its status palette, at the toast strength of the mesh. */
const toastMesh = (palette: string) => ({
  ...toastPanel,
  colorPalette: palette,
  ...statusMesh("toast"),
});

/** A light-mode solid badge is quiet glass on its palette's solid colour: a fine rim, a light. */
const badgeGlass = {
  color: "colorPalette.onSolid",
  bg: "colorPalette.solid",
  backgroundImage:
    "linear-gradient(180deg, rgba(255, 255, 255, 0.18) 0%, rgba(255, 255, 255, 0.04) 50%, transparent 100%)",
  boxShadow: [
    "inset 0 0 0 1px color-mix(in srgb, var(--chakra-colors-color-palette-700) 35%, transparent)",
    "inset 0 1px 0 rgba(255, 255, 255, 0.2)",
  ].join(", "),
};

export const designSystemConfig = defineConfig({
  globalCss: {
    body: {
      background: "bg.page",
      fontSize: "14px",
      color: "fg",
    },
    "*::selection": {
      // Undo Chakra's selection color override
      // @ts-expect-error Chakra types `bg` as a token string; `null` unsets
      // the property, and it types no null.
      bg: null,
    },
    // Chakra's `CodeBlock` paints highlighted lines via an absolutely
    // positioned `::after` on `[data-line][data-highlight]`, backed by
    // `--highlight-bg` and a hardcoded gray border. Overridden globally so
    // every code block lights up in the LangWatch tracing orange.
    "[data-line][data-highlight], [data-line][data-diff]": {
      "--highlight-bg": "rgba(237, 137, 38, 0.18)",
    },
    "[data-line][data-highlight]::after, [data-line][data-diff]::after": {
      borderInlineStartColor: "#ED8926 !important",
      background:
        "color-mix(in srgb, var(--chakra-colors-orange-emphasized) 20%, transparent) !important",
    },
    // Low FPS: turn off decorative blur and adjust transparency to opaque so
    // frosted-glass surfaces don't appear as plain tints.
    'html[data-reduced-graphics="true"]': {
      "--lw-backdrop-blur": "none",
      "--lw-panel-alpha": "100%",
    },
  },
  theme: {
    textStyles: { ...productTextStyles, ...takeoverTextStyles },
    keyframes: {
      // A toast rises a few pixels into place and fades out where it is: no blur, no scale.
      "toast-in": {
        from: { transform: "translateY(16px)", opacity: 0 },
        to: { transform: "none", opacity: 1 },
      },
      "toast-fade": { from: { opacity: 1 }, to: { opacity: 0 } },
    },
    tokens: {
      sizes: { pageHeader: { lg: { value: "48px" }, sm: { value: "48px" } } },
      fonts: {
        heading: {
          value: interFontFamily,
        },
        body: {
          value: interFontFamily,
        },
        display: {
          value: displayFontFamily,
        },
        mono: {
          value: monoFontFamily,
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
      radii: { showcase: { value: "{radii.xl}" } },
      shadows: { showcase: { value: "{shadows.md}" } },
      colors: {
        // Terminal roles preserve the existing ANSI rendering in both colour modes.
        terminal: {
          fg: { value: { _light: "{colors.fg}", _dark: "{colors.fg}" } },
          bg: { value: { _light: "{colors.bg.card}", _dark: "{colors.bg.card}" } },
          black: { value: { _light: "{colors.fg.subtle}", _dark: "{colors.fg.subtle}" } },
          red: { value: { _light: "{colors.red.fg}", _dark: "{colors.red.fg}" } },
          green: { value: { _light: "{colors.green.fg}", _dark: "{colors.green.fg}" } },
          yellow: { value: { _light: "{colors.yellow.fg}", _dark: "{colors.yellow.fg}" } },
          blue: { value: { _light: "{colors.blue.fg}", _dark: "{colors.blue.fg}" } },
          magenta: { value: { _light: "{colors.purple.fg}", _dark: "{colors.purple.fg}" } },
          cyan: { value: { _light: "{colors.cyan.fg}", _dark: "{colors.cyan.fg}" } },
          white: { value: { _light: "{colors.fg}", _dark: "{colors.fg}" } },
          brightBlack: { value: { _light: "{colors.fg.muted}", _dark: "{colors.fg.muted}" } },
          brightRed: { value: { _light: "{colors.red.fg}", _dark: "{colors.red.fg}" } },
          brightGreen: { value: { _light: "{colors.green.fg}", _dark: "{colors.green.fg}" } },
          brightYellow: { value: { _light: "{colors.yellow.fg}", _dark: "{colors.yellow.fg}" } },
          brightBlue: { value: { _light: "{colors.blue.fg}", _dark: "{colors.blue.fg}" } },
          brightMagenta: { value: { _light: "{colors.pink.fg}", _dark: "{colors.pink.fg}" } },
          brightCyan: { value: { _light: "{colors.cyan.fg}", _dark: "{colors.cyan.fg}" } },
          brightWhite: { value: { _light: "{colors.fg}", _dark: "{colors.fg}" } },
        },
        // Fixed illustration pigments keep the artwork identical in either mode.
        illustration: {
          sunShadow: { value: { _light: "#ECC94B", _dark: "#ECC94B" } },
          sun: { value: { _light: "#F6E05E", _dark: "#F6E05E" } },
          ink: { value: { _light: "#3C2415", _dark: "#3C2415" } },
          cloud: { value: { _light: "#BEE3F8", _dark: "#BEE3F8" } },
          python: { value: { _light: "#4584b6", _dark: "#4584b6" } },
          typescript: { value: { _light: "#2563eb", _dark: "#2563eb" } },
          go: { value: { _light: "#00ADD8", _dark: "#00ADD8" } },
        },
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
          indicator: { value: "{colors.fg}" },
          onSolid: { value: "{colors.gray.contrast}" },
        },
        orange: {
          solid: { value: { _light: "#ED8926", _dark: "#ED8926" } },
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
          indicator: { value: "{colors.orange.solid}" },
          onSolid: { value: "{colors.gray.950}" },
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
          indicator: { value: "{colors.green.solid}" },
          onSolid: { value: "{colors.gray.950}" },
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
          indicator: { value: "{colors.blue.solid}" },
          onSolid: { value: "{colors.gray.950}" },
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
          indicator: { value: "{colors.yellow.solid}" },
          onSolid: { value: "{colors.gray.950}" },
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
          indicator: { value: "{colors.red.solid}" },
          onSolid: { value: "{colors.gray.950}" },
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
          indicator: { value: "{colors.pink.solid}" },
          onSolid: { value: "{colors.gray.950}" },
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
          indicator: { value: "{colors.purple.solid}" },
          onSolid: { value: { _light: "white", _dark: "{colors.gray.950}" } },
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
          indicator: { value: "{colors.teal.solid}" },
          onSolid: { value: "{colors.gray.950}" },
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
          indicator: { value: "{colors.cyan.solid}" },
          onSolid: { value: "{colors.gray.950}" },
        },

        // Brand orange as LangWatch's accent; status.warning remains yellow.
        // An alias palette: `colorPalette="accent"` follows the orange group.
        accent: {
          solid: { value: "{colors.orange.solid}" },
          contrast: { value: "{colors.orange.contrast}" },
          fg: { value: "{colors.orange.fg}" },
          muted: { value: "{colors.orange.muted}" },
          subtle: { value: "{colors.orange.subtle}" },
          emphasized: { value: "{colors.orange.emphasized}" },
          hover: { value: "{colors.orange.hover}" },
          focusRing: { value: "{colors.orange.focusRing}" },
          indicator: { value: "{colors.orange.indicator}" },
          onSolid: { value: "{colors.orange.onSolid}" },
        },

        // product.<id>.<role> aliases, generated from the one map in product-colours.ts.
        product: productColourTokens({ colours: PRODUCT_COLOURS }),

        // The logo: brand navy with white faces on light; on dark the faces
        // drop out and the lines go off-white, as the dark-theme wordmark draws it.
        logo: {
          mark: { value: { _light: "#213B41", _dark: "{colors.gray.100}" } },
          face: { value: { _light: "white", _dark: "transparent" } },
          wordmark: { value: { _light: "#1D293D", _dark: "{colors.gray.100}" } },
          wordmarkMuted: { value: { _light: "#314158", _dark: "{colors.gray.300}" } },
        },

        // Data series, in the order `rotatingColors` hands out hues.
        chart: {
          1: { value: { _light: "{colors.orange.500}", _dark: "{colors.orange.300}" } },
          2: { value: { _light: "{colors.blue.500}", _dark: "{colors.blue.300}" } },
          3: { value: { _light: "{colors.green.500}", _dark: "{colors.green.300}" } },
          4: { value: { _light: "{colors.yellow.500}", _dark: "{colors.yellow.300}" } },
          5: { value: { _light: "{colors.purple.500}", _dark: "{colors.purple.300}" } },
          6: { value: { _light: "{colors.teal.500}", _dark: "{colors.teal.300}" } },
          7: { value: { _light: "{colors.cyan.500}", _dark: "{colors.cyan.300}" } },
          8: { value: { _light: "{colors.pink.500}", _dark: "{colors.pink.300}" } },
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
          // Branch-only roles alias the production main palette.
          marker: { value: "{colors.fg.subtle}" },
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
            value: { _light: "{colors.gray.500}", _dark: "{colors.gray.400}" },
          },
        },

        // Background semantic tokens - custom light theme, dark theme with inverted hierarchy
        bg: {
          DEFAULT: { value: { _light: "{colors.white}", _dark: "{colors.black}" } },
          // Branch-only roles alias the production main palette.
          // Dark is the user's chosen ink, not a Chakra step.
          card: { value: { _light: "{colors.bg.panel}", _dark: "#0f1116" } },
          overlay: { value: "{colors.bg.panel}" },
          // The callable Drawer's header and footer, at card strength (drawer-chrome).
          drawer: { chrome: { value: "{colors.bg.card}" } },
          nested: { value: "{colors.bg.muted}" },
          raised: { value: "{colors.bg.panel}" },
          // Light fields are white on the grey page, as main's were; grey read as disabled.
          control: { value: { _light: "{colors.bg.surface}", _dark: "{colors.bg.input}" } },
          hover: { value: "{colors.bg.softHover}" },
          selected: { value: "{colors.nav.bgActive}" },
          stripe: { value: "{colors.bg.subtle}" },
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
          // Status surfaces, one per meaning.
          error: { value: { _light: "{colors.red.50}", _dark: "{colors.red.950}" } },
          success: { value: { _light: "{colors.green.50}", _dark: "{colors.green.950}" } },
          warning: { value: { _light: "{colors.orange.50}", _dark: "{colors.orange.950}" } },
          info: { value: { _light: "{colors.blue.50}", _dark: "{colors.blue.950}" } },
          // Dimmer behind modals, tours and overlays.
          scrim: {
            value: { _light: "{colors.blackAlpha.500}", _dark: "{colors.blackAlpha.700}" },
          },
          // The development badge: a dark pill over the top bar's glow, in both modes.
          devBadge: { value: "{colors.blackAlpha.600}" },
        },
        // Guided onboarding takeover: the warm glow it stands on, its card shadows and the white-on
        // pick-order badge (4.5:1). Fixed brand values; the two wide glows deepen on a dark ground.
        takeover: {
          glowPeach: {
            value: { _light: "rgba(255, 232, 204, 0.9)", _dark: "rgba(101, 43, 25, 0.9)" },
          },
          glowApricot: {
            value: { _light: "rgba(253, 214, 166, 0.75)", _dark: "rgba(123, 52, 30, 0.75)" },
          },
          glowOrange: { value: "rgba(237, 137, 38, 0.10)" },
          glowSoft: { value: "rgba(237, 137, 38, 0.06)" },
          glowFaint: { value: "rgba(237, 137, 38, 0.02)" },
          lift: { value: "rgba(26, 26, 46, 0.10)" },
          liftSoft: { value: "rgba(26, 26, 46, 0.08)" },
          badge: { value: "#c2510a" },
          // The guided tour's dim around its spotlight, deeper while a finished step stays lit.
          tourDim: { value: "rgba(15, 15, 30, 0.35)" },
          tourDimLit: { value: "rgba(15, 15, 30, 0.5)" },
        },
        // Avatar fills under `fg.onColor` initials: each step keeps white at 3:1 or more.
        avatar: {
          orange: { value: { _light: "{colors.orange.600}", _dark: "{colors.orange.700}" } },
          blue: { value: { _light: "{colors.blue.400}", _dark: "{colors.blue.600}" } },
          green: { value: { _light: "{colors.green.500}", _dark: "{colors.green.700}" } },
          yellow: { value: { _light: "{colors.yellow.600}", _dark: "{colors.yellow.700}" } },
          purple: { value: { _light: "{colors.purple.400}", _dark: "{colors.purple.700}" } },
          teal: { value: { _light: "{colors.teal.500}", _dark: "{colors.teal.700}" } },
          cyan: { value: { _light: "{colors.cyan.700}", _dark: "{colors.cyan.700}" } },
          pink: { value: { _light: "{colors.pink.500}", _dark: "{colors.pink.700}" } },
        },

        // Evaluation status dots, accents and fills: one colour per status, the same in
        // both modes. An error is one step deeper than a failed verdict.
        evaluation: {
          pending: { value: "{colors.gray.400}" },
          running: { value: "{colors.blue.400}" },
          passed: { value: "{colors.green.500}" },
          failed: { value: "{colors.red.500}" },
          processed: { value: "{colors.blue.500}" },
          error: { value: "{colors.red.600}" },
          skipped: { value: "{colors.gray.300}" },
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
          // Text on a saturated fill in both modes: avatar initials, the development badge.
          onColor: { value: "white" },
          // Status text, one per meaning.
          error: { value: { _light: "{colors.red.500}", _dark: "{colors.red.400}" } },
          success: { value: { _light: "{colors.green.600}", _dark: "{colors.green.300}" } },
          warning: { value: { _light: "{colors.orange.600}", _dark: "{colors.orange.300}" } },
          info: { value: { _light: "{colors.blue.600}", _dark: "{colors.blue.300}" } },
        },

        // Border semantic tokens - visible in dark mode
        border: {
          // Branch-only roles alias the production main palette.
          card: { value: { _light: "{colors.border}", _dark: "#3a3a44" } },
          // A drawer header or footer edge, and the faint highlight along it (drawer-chrome).
          drawer: {
            edge: { value: "{colors.border.card}" },
            glint: {
              value: {
                _light: "color-mix(in srgb, {colors.white} 45%, transparent)",
                _dark: "color-mix(in srgb, {colors.white} 18%, transparent)",
              },
            },
          },
          nested: { value: "{colors.border.muted}" },
          control: { value: "{colors.border}" },
          strong: { value: "{colors.border.emphasized}" },
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
          // Status borders, one per meaning.
          error: { value: { _light: "{colors.red.500}", _dark: "{colors.red.400}" } },
          success: { value: { _light: "{colors.green.500}", _dark: "{colors.green.400}" } },
          warning: { value: { _light: "{colors.orange.500}", _dark: "{colors.orange.400}" } },
          info: { value: { _light: "{colors.blue.500}", _dark: "{colors.blue.400}" } },
        },
      },
    },
    recipes: {
      sectionNavigationRail: sectionNavigationRailRecipe,
      skeleton: defineRecipe({
        base: {
          "--skeleton-from": "{colors.gray.100}",
          "--skeleton-to": "{colors.gray.200}",
          _dark: {
            "--skeleton-from": "{colors.zinc.800}",
            "--skeleton-to": "{colors.zinc.700}",
          },
        },
      }),
      heading: defineRecipe({
        base: {
          fontWeight: "600",
          color: "fg",
        },
        variants: {
          size: {
            sm: { textStyle: "sectionTitle" },
            md: { textStyle: "metric" },
            lg: { textStyle: "pageTitle" },
            xl: { textStyle: "2xl" },
            "2xl": { textStyle: "3xl" },
            "3xl": { textStyle: "4xl" },
            "4xl": { textStyle: "5xl" },
          },
        },
        defaultVariants: {
          size: "md",
        },
      }),
      link: defineRecipe({
        base: {
          focusVisibleRing: "outside",
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
              borderColor: "border",
              color: "fg",
              _hover: {
                backgroundColor: "bg.hover",
                boxShadow: "inset 0 -2px 5px 0px rgba(0, 0, 0, 0.03)",
              },
              _expanded: {
                backgroundColor: "bg.hover",
              },
            },
            ghost: {
              color: "fg",
              _hover: {
                backgroundColor: "bg.hover",
              },
              _expanded: {
                backgroundColor: "bg.hover",
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
              textStyle: "bodySm",
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
            subtle: { bg: "bg.control", borderColor: "border.control" },
            outline: {
              bg: "bg.control",
              borderColor: "border.control",
            },
            flushed: {
              borderRadius: "none",
              borderBottomColor: "border.control",
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
            subtle: { bg: "bg.control", borderColor: "border.control" },
            outline: {
              bg: "bg.control",
              borderColor: "border.control",
            },
          },
        },
      }),
      radio: defineRecipe({
        base: {
          bg: "bg.control",
          borderColor: "border.control",
          "& .dot": {
            bg: "bg.control",
            borderColor: "border.control",
          },
        },
      }),
      badge: defineRecipe({
        base: {
          borderRadius: "lg",
          maxWidth: "100%",
          minWidth: 0,
          overflow: "hidden",
        },
        variants: { variant: { solid: { color: "colorPalette.onSolid", _light: badgeGlass } } },
      }),
    },
    slotRecipes: {
      segmentGroup: segmentGroupSlotRecipe,
      radioCard: defineSlotRecipe({
        slots: ["item", "itemDescription"],
        base: {
          item: { borderColor: "border.control" },
          itemDescription: { color: "fg.muted", opacity: 1 },
        },
        variants: {
          variant: {
            outline: {
              item: {
                _checked: {
                  bg: "colorPalette.muted/20",
                  borderColor: "colorPalette.solid",
                  boxShadowColor: "colorPalette.solid",
                },
              },
            },
          },
        },
      }),
      tooltip: defineSlotRecipe({
        slots: ["content", "arrow", "arrowTip"],
        base: {
          content: {
            bg: "bg.overlay",
            color: "fg",
            border: "1px solid",
            borderColor: "border.card",
            borderRadius: "md",
            boxShadow: "lg",
            px: "3",
            py: "2",
            textStyle: "xs",
          },
          arrow: {
            "--arrow-background": "colors.bg.overlay",
          },
          arrowTip: {
            borderColor: "colors.bg.overlay",
          },
        },
      }),
      card: defineSlotRecipe({
        slots: ["root"],
        base: {
          root: {
            borderRadius: "xl",
            transition: "all 0.2s ease-in-out",
            // The card tint at half strength, blurred: the ground's colour shows through and
            // every card blends with it, as home's did.
            background: "bg.card/50",
            backdropFilter: "blur(12px)",
            borderColor: "border.card",
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
            showcase: {
              root: {
                borderWidth: "1px",
                borderStyle: "solid",
                borderColor: "border.card",
                background: "bg.card/50",
                borderRadius: "showcase",
                boxShadow: "showcase",
              },
            },
            subtle: {
              root: {
                background: "bg.nested",
                borderWidth: "1px",
                borderStyle: "solid",
                borderColor: "border.nested",
              },
            },
            // `bg` and `borderColor` by the same keys Chakra's own variants set, so ours win.
            outline: {
              root: {
                bg: "bg.card/50",
                borderWidth: "1px",
                borderStyle: "solid",
                borderColor: "border.card",
                boxShadow: "2xs",
              },
            },
            // A card that sits up off the page: a fine hairline and a soft shadow, as the
            // governance figures use. A clickable card adds its own hover lift.
            elevated: {
              root: {
                bg: "bg.card/50",
                borderWidth: "1px",
                borderStyle: "solid",
                borderColor: "border.card",
                boxShadow: "md",
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
            bg: "bg.control",
            borderColor: "border.control",
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
                borderColor: "border.control",
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
          // @ts-expect-error Recipe declares only `variant`, not `size`. Chakra
          // forwards it to Ark anyway.
          size: "sm",
        },
      }),
      tabs: defineSlotRecipe({
        slots: ["root", "list", "trigger"],
        base: {
          root: { "--tabs-indicator-bg": "colors.bg.selected" },
          trigger: {
            height: "auto",
          },
        },
        variants: {
          variant: {
            line: {
              trigger: {
                color: "fg.muted",
                _selected: {
                  color: "fg",
                  fontWeight: "600",
                  "--indicator-color": "colors.colorPalette.indicator",
                  "--indicator-thickness": "2px",
                },
              },
            },
            subtle: {
              list: {
                borderBottom: "none",
              },
              trigger: {
                _selected: { bg: "bg.selected" },
                borderRadius: "lg",
              },
            },
            enclosed: {
              list: {
                bg: "bg.control",
                borderWidth: "1px",
                borderColor: "border.control",
                borderRadius: "lg",
                gap: 1,
              },
              trigger: {
                borderRadius: "lg",
                _selected: {
                  bg: "bg.selected",
                  boxShadow: "none",
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
                textStyle: "bodySm",
              },
            },
          },
        },
      }),
      menu: defineSlotRecipe({
        slots: ["item", "content"],
        base: { content: optionListContent, item: optionItemRecipe.base },
        variants: {
          size: optionListSizes,
          variant: {
            subtle: { item: optionItemRecipe.base },
            solid: { item: optionItemRecipe.base },
          },
        },
      }),
      combobox: defineSlotRecipe({
        slots: ["item", "content"],
        base: { content: optionListContent, item: optionItemRecipe.base },
        variants: { size: optionListSizes },
      }),
      table: defineSlotRecipe({
        slots: ["root", "row", "cell", "columnHeader", "header", "body"],
        base: {
          // The container owns the ground, including rounded corners.
          root: {
            background: "transparent",
            borderRadius: "md",
            // Clip rounded cells without introducing a scroll ancestor for sticky headers.
            overflow: "clip",
            borderCollapse: "separate",
            borderSpacing: 0,
            fontVariantNumeric: "normal",
          },
          row: {
            bg: "transparent",
            _hover: { bg: "bg.hover" },
            _selected: { bg: "bg.selected", _hover: { bg: "bg.selected" } },
          },
          columnHeader: {
            fontWeight: "semibold",
            textStyle: "xs",
            textTransform: "uppercase",
            color: "fg.muted",
            letterSpacing: "wider",
          },
        },
        variants: {
          interactive: {
            true: {
              body: { "& tr": { _hover: { bg: "bg.hover" }, _selected: { bg: "bg.selected" } } },
            },
          },
          striped: {
            true: { row: { "&:nth-of-type(odd) td": { bg: "bg.stripe" } } },
          },
          variant: {
            // add grid variant following previous pattern
            grid: {
              root: {
                background: "transparent",
              },
              columnHeader: {
                border: "1px solid",
                borderColor: "border",
                bg: "transparent",
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
              // Chakra's stock line variant paints every row bg="bg" (the
              // PAGE background), a mismatched slab in dark mode. Must
              // override the same `bg` KEY — a `background` key merges
              // alongside it instead of replacing it, so the stock paint wins.
              row: {
                bg: "transparent",
              },
              columnHeader: {
                borderColor: "border",
                bg: "transparent",
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
                bg: "transparent",
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
                textStyle: "micro",
                paddingY: 2,
                paddingX: 3,
              },
              cell: {
                textStyle: "bodySm",
                lineHeight: "1em",
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
            textStyle: "sectionTitle",
          },
          // A dialog panel is opaque: the blur behind it is the backdrop's, never the panel's.
          content: {
            background: "bg.overlay",
            border: "1px solid",
            borderColor: "border.card",
            borderRadius: "lg",
            boxShadow: "lg",
            "& button[data-variant=solid], & button[data-variant=outline]": {
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
        slots: ["trigger", "content", "item"],
        base: {
          trigger: {
            cursor: "pointer",
            borderRadius: "lg",
            bg: "bg.control",
            borderColor: "border.control",
          },
          content: optionListContent,
          item: optionItemRecipe.base,
        },
        variants: {
          variant: {
            outline: { trigger: { bg: "bg.control", borderColor: "border.control" } },
            subtle: { trigger: { bg: "bg.control", borderColor: "border.control" } },
            ghost: { trigger: { bg: "transparent", _expanded: { bg: "bg.hover" } } },
          },
          size: optionListSizes,
        },
      }),
      popover: defineSlotRecipe({
        slots: ["content"],
        base: {
          content: {
            background: "bg.overlay",
            border: "1px solid",
            borderColor: "border.card",
            borderRadius: "lg",
            boxShadow: "lg",
          },
        },
      }),
      nativeSelect: defineSlotRecipe({
        slots: [],
        variants: {
          variant: {
            subtle: { field: { bg: "bg.control", borderColor: "border.control" } },
            outline: {
              field: {
                borderRadius: "lg",
                bg: "bg.control",
                borderColor: "border.control",
              },
            },
          },
        },
      }),
      codeBlock: defineSlotRecipe({
        slots: ["root", "header"],
        base: {
          root: {
            bg: "bg.nested",
            borderColor: "border.nested",
            "--code-block-bg": "colors.bg.nested",
          },
          header: { borderColor: "border.nested" },
        },
      }),
      drawer: drawerSlotRecipe,
      toast: defineSlotRecipe({
        slots: ["root", "title", "description"],
        base: {
          root: {
            borderRadius: "xl",
            boxShadow: "lg",
            border: "1px solid",
            // The icon, the title and the close button share the title's line,
            // so a one-line toast is as tall as its text plus the padding.
            alignItems: "flex-start",
            gap: "2.5",
            paddingBlock: "3",
            // The close button holds 2px of slack around its glyph, so 3 here
            // lands it as far from the right edge as the icon is from the left.
            paddingInlineStart: "3.5",
            paddingInlineEnd: "3",
            // The stack measures a card unscaled before it mounts, so cards behind keep its height.
            "&:not([data-mounted])": { scale: "1" },
            transitionProperty: "translate, scale, opacity, height",
            // Collapsed, the newest card and two behind it show; behind cards show no content.
            // Cards behind recede: 6% smaller each, softer shadow, under a floating front card.
            "&[data-overlap]": {
              opacity: "clamp(0, calc(var(--opacity) * (3 - var(--index))), 1)",
              transformOrigin: "top center",
              translate: "0 calc(var(--y) - var(--toast-peek, 0) * var(--index) * 1px)",
              scale: "calc(1 - var(--index) * 0.06)",
              "&:not([data-mounted])": { scale: "1" },
              boxShadow: "md",
              "&[data-first]": { boxShadow: "2xl" },
              "&:not([data-first]) > *": { opacity: 0 },
            },
            // A soft spring with a slight settle, as iOS stacks move; the curve is the spring
            // sampled into linear(), so CSS runs it without JavaScript.
            transitionDuration: "460ms",
            transitionTimingFunction: TOAST_SPRING,
            "&[data-state=open]": {
              animation: `toast-in 460ms ${TOAST_SPRING} backwards`,
            },
            "&[data-state=closed]": { animation: "toast-fade 120ms ease-in both" },
            _motionReduce: {
              transition: "none",
              animation: "none",
              "&[data-state=open]": { animation: "none" },
              "&[data-state=closed]": { animation: "none", opacity: 0 },
            },
            // A status toast wears the middle strength of the status mesh. Repeated per type to
            // outrank Chakra's own filled defaults.
            ...toastPanel,
            "&[data-type=loading]": toastPanel,
            "&[data-type=error]": toastMesh("red"),
            "&[data-type=warning]": toastMesh("orange"),
            "&[data-type=success]": toastMesh("green"),
            "&[data-type=info]": toastMesh("blue"),
            // Collapsed, each card behind the front one sits a shade darker than the one before.
            "&[data-overlap][data-type]": { backgroundImage: deepeningMesh("toast") },
            "&[data-overlap][data-type=loading]": {
              backgroundImage:
                "linear-gradient(rgba(0, 0, 0, calc(var(--index, 0) * 0.2)), rgba(0, 0, 0, calc(var(--index, 0) * 0.2)))",
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
      alert: alertSlotRecipe,
      radioGroup: defineSlotRecipe({
        slots: ["itemControl"],
        base: {
          itemControl: {
            bg: "bg.control",
            borderColor: "border.control",
          },
        },
      }),
    },
  },
});
