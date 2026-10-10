import type React from "react";

/**
 * Global `<style>` tag that injects the drawer + sidebar tour-glow keyframes and
 * stage-gated selectors.
 */
export const DrawerGlow: React.FC = () => (
  <style>{`
    @keyframes tracesTourDrawerGlow {
      0%, 100% {
        box-shadow:
          inset 0 0 0 1px color-mix(in srgb, var(--chakra-colors-blue-fg) 50%, transparent),
          0 0 28px color-mix(in srgb, var(--chakra-colors-blue-fg) 32%, transparent),
          0 0 64px color-mix(in srgb, var(--chakra-colors-purple-fg) 22%, transparent);
      }
      50% {
        box-shadow:
          inset 0 0 0 2px color-mix(in srgb, var(--chakra-colors-blue-fg) 70%, transparent),
          0 0 44px color-mix(in srgb, var(--chakra-colors-blue-fg) 45%, transparent),
          0 0 96px color-mix(in srgb, var(--chakra-colors-purple-fg) 32%, transparent);
      }
    }
    @keyframes tracesTourSidebarGlow {
      /*
        The sidebar lives inside an outer HStack with overflow:hidden,
        so any *outer* box-shadow gets clipped on three sides: the
        previous glow only ever read as a thin line on the right edge.
        We compose the highlight from inset layers exclusively (a
        coloured outline plus a soft inner halo that fades from the
        edge inward) so the effect renders correctly on all four
        sides regardless of ancestor overflow.
      */
      0%, 100% {
        box-shadow:
          inset 0 0 0 2px color-mix(in srgb, var(--chakra-colors-blue-fg) 55%, transparent),
          inset 0 0 22px color-mix(in srgb, var(--chakra-colors-blue-fg) 28%, transparent);
      }
      50% {
        box-shadow:
          inset 0 0 0 3px color-mix(in srgb, var(--chakra-colors-blue-fg) 75%, transparent),
          inset 0 0 36px color-mix(in srgb, var(--chakra-colors-blue-fg) 42%, transparent);
      }
    }
    body[data-traces-tour-stage="drawerOverview"] [data-tour-target="drawer"] {
      animation: tracesTourDrawerGlow 2.6s ease-in-out infinite;
    }
    body[data-traces-tour-stage="facetsReveal"] [data-tour-target="sidebar"] {
      animation: tracesTourSidebarGlow 2.4s ease-in-out infinite;
      position: relative;
      z-index: 1;
    }
    html.dark body[data-traces-tour-stage="drawerOverview"] [data-tour-target="drawer"] {
      animation: tracesTourDrawerGlowDark 2.6s ease-in-out infinite;
    }
    html.dark body[data-traces-tour-stage="facetsReveal"] [data-tour-target="sidebar"] {
      animation: tracesTourSidebarGlowDark 2.4s ease-in-out infinite;
    }
    @keyframes tracesTourDrawerGlowDark {
      0%, 100% {
        box-shadow:
          inset 0 0 0 1px color-mix(in srgb, var(--chakra-colors-blue-fg) 32%, transparent),
          0 0 28px color-mix(in srgb, var(--chakra-colors-blue-fg) 22%, transparent),
          0 0 64px color-mix(in srgb, var(--chakra-colors-purple-fg) 16%, transparent);
      }
      50% {
        box-shadow:
          inset 0 0 0 2px color-mix(in srgb, var(--chakra-colors-blue-fg) 55%, transparent),
          0 0 44px color-mix(in srgb, var(--chakra-colors-blue-fg) 40%, transparent),
          0 0 96px color-mix(in srgb, var(--chakra-colors-purple-fg) 30%, transparent);
      }
    }
    @keyframes tracesTourSidebarGlowDark {
      0%, 100% {
        box-shadow:
          inset 0 0 0 2px color-mix(in srgb, var(--chakra-colors-blue-fg) 40%, transparent),
          inset 0 0 22px color-mix(in srgb, var(--chakra-colors-blue-fg) 22%, transparent);
      }
      50% {
        box-shadow:
          inset 0 0 0 3px color-mix(in srgb, var(--chakra-colors-blue-fg) 60%, transparent),
          inset 0 0 36px color-mix(in srgb, var(--chakra-colors-blue-fg) 36%, transparent);
      }
    }
  `}</style>
);
