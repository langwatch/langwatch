import type React from "react";

/**
 * Global `<style>` tag that injects the drawer + sidebar tour-glow
 * keyframes and stage-gated selectors. The actual targets
 * (`[data-tour-target="drawer"]`, `[data-tour-target="sidebar"]`)
 * live deep in the page tree — the drawer is even portaled to body —
 * so a Chakra-scoped `css` prop can't reach them. A document-level
 * stylesheet is the simplest hook.
 *
 * Mounted only when `OnboardingHost` decides onboarding is active, so
 * users not in the journey don't get an extra `<style>` tag, and the
 * @keyframes don't sit in their stylesheet for the lifetime of the
 * tab.
 *
 * Light/dark variants live in the same sheet — the dark-mode
 * overrides use `html.dark` (Chakra v3's class-based color mode),
 * not `prefers-color-scheme`, so the glow follows the user's *theme*
 * choice rather than their OS preference.
 */
export const DrawerGlow: React.FC = () => (
  <style>{`
    @keyframes tracesTourDrawerGlow {
      0%, 100% {
        box-shadow:
          inset 0 0 0 1px rgba(59, 130, 246, 0.5),
          0 0 28px rgba(59, 130, 246, 0.32),
          0 0 64px rgba(99, 102, 241, 0.22);
      }
      50% {
        box-shadow:
          inset 0 0 0 2px rgba(59, 130, 246, 0.7),
          0 0 44px rgba(59, 130, 246, 0.45),
          0 0 96px rgba(99, 102, 241, 0.32);
      }
    }
    @keyframes tracesTourSidebarGlow {
      /*
        The sidebar lives inside an outer HStack with overflow:hidden,
        so any *outer* box-shadow gets clipped on three sides — the
        previous glow only ever read as a thin line on the right edge.
        We compose the highlight from inset layers exclusively (a
        coloured outline plus a soft inner halo that fades from the
        edge inward) so the effect renders correctly on all four
        sides regardless of ancestor overflow.
      */
      0%, 100% {
        box-shadow:
          inset 0 0 0 2px rgba(59, 130, 246, 0.55),
          inset 0 0 22px rgba(59, 130, 246, 0.28);
      }
      50% {
        box-shadow:
          inset 0 0 0 3px rgba(59, 130, 246, 0.75),
          inset 0 0 36px rgba(59, 130, 246, 0.42);
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
          inset 0 0 0 1px rgba(125, 211, 252, 0.32),
          0 0 28px rgba(125, 211, 252, 0.22),
          0 0 64px rgba(165, 180, 252, 0.16);
      }
      50% {
        box-shadow:
          inset 0 0 0 2px rgba(125, 211, 252, 0.55),
          0 0 44px rgba(125, 211, 252, 0.4),
          0 0 96px rgba(165, 180, 252, 0.3);
      }
    }
    @keyframes tracesTourSidebarGlowDark {
      0%, 100% {
        box-shadow:
          inset 0 0 0 2px rgba(125, 211, 252, 0.4),
          inset 0 0 22px rgba(125, 211, 252, 0.22);
      }
      50% {
        box-shadow:
          inset 0 0 0 3px rgba(125, 211, 252, 0.6),
          inset 0 0 36px rgba(125, 211, 252, 0.36);
      }
    }
  `}</style>
);
