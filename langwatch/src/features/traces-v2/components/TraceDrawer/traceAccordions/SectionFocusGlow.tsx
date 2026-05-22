import type React from "react";

/**
 * One-shot blue pulse keyed off `data-section-focus="1"` on any
 * `Accordion.Item` rendered by `Section`. The header chips publish a
 * focus request to `useFocusSectionStore`; `TraceSummaryAccordions`
 * observes it, expands the matching section, scrolls it into view,
 * and toggles the data attribute long enough for the keyframe to
 * play. The keyframe self-clears via `forwards` so the section
 * settles back to its normal chrome without us having to remove the
 * attribute on a timer.
 *
 * Why a dedicated stylesheet rather than a Chakra `css={}` prop: the
 * `Accordion.Item` already binds `data-state` and `data-section`
 * attributes for its own state-recipe machinery, and layering another
 * inline-CSS prop fights the recipe's specificity. A document-level
 * keyframe definition + selector keeps the recipe untouched.
 *
 * The colour palette mirrors the existing onboarding `DrawerGlow`
 * recipe so the two glows read as the same affordance, with two
 * deliberate differences: this one runs once and fades, and the
 * outer halo is restricted (a section sits inside an `overflow: auto`
 * pane so a wide outer shadow would get clipped — keep it close to
 * the box).
 */
export const SectionFocusGlow: React.FC = () => (
  <style>{`
    @keyframes tracesV2SectionFocusGlow {
      0% {
        box-shadow:
          inset 0 0 0 0 rgba(59, 130, 246, 0),
          0 0 0 0 rgba(59, 130, 246, 0);
      }
      18% {
        box-shadow:
          inset 0 0 0 2px rgba(59, 130, 246, 0.65),
          0 0 22px rgba(59, 130, 246, 0.38);
      }
      100% {
        box-shadow:
          inset 0 0 0 0 rgba(59, 130, 246, 0),
          0 0 0 0 rgba(59, 130, 246, 0);
      }
    }
    @keyframes tracesV2SectionFocusGlowDark {
      0% {
        box-shadow:
          inset 0 0 0 0 rgba(125, 211, 252, 0),
          0 0 0 0 rgba(125, 211, 252, 0);
      }
      18% {
        box-shadow:
          inset 0 0 0 2px rgba(125, 211, 252, 0.55),
          0 0 22px rgba(125, 211, 252, 0.36);
      }
      100% {
        box-shadow:
          inset 0 0 0 0 rgba(125, 211, 252, 0),
          0 0 0 0 rgba(125, 211, 252, 0);
      }
    }
    [data-section-focus="1"] {
      animation: tracesV2SectionFocusGlow 1500ms ease-out 1;
      border-radius: 4px;
      position: relative;
      z-index: 1;
    }
    html.dark [data-section-focus="1"] {
      animation-name: tracesV2SectionFocusGlowDark;
    }
  `}</style>
);
