import { Flex, Icon, Text } from "@chakra-ui/react";
import { Sparkles } from "lucide-react";
import type React from "react";

/**
 * Persistent banner across the top of the table while the trace list
 * is rendering `SAMPLE_PREVIEW_TRACES` (i.e. `usePreviewTracesActive`
 * is true).
 *
 * Honesty affordance — the moment the user tries a facet, search, or
 * filter the substring matcher in `filterPreviewTraces` will
 * frequently return zero rows (e.g. a service facet for
 * "production-api" doesn't substring-match the fixture services).
 * Without the banner that reads as a broken product. With it, the
 * user knows "ah, sample data, this is just a tour."
 *
 * Visual treatment: a one-shot orange glow blooms on mount and fades
 * out over ~10s. The point is "catch the eye on first arrival without
 * permanently shouting." After the glow fades the banner stays as a
 * slightly bolder, slightly taller strip — still honest, no longer
 * demanding attention.
 *
 * Exit lives on the toolbar's "Hide sample data" button, not here —
 * one exit affordance, not two.
 *
 * Visible only when preview is active — once dismissed, this whole
 * pane unmounts and the banner with it.
 */
export const SampleDataBanner: React.FC = () => {
  return (
    <Flex
      align="center"
      gap={2}
      paddingX={3.5}
      paddingY={2.5}
      background="orange.subtle"
      borderBottomWidth="1px"
      borderColor="orange.muted"
      color="orange.fg"
      flexShrink={0}
      position="relative"
      overflow="hidden"
      css={{
        animation: "lw-sample-banner-glow 10s ease-out forwards",
        "@keyframes lw-sample-banner-glow": {
          "0%": {
            boxShadow:
              "0 0 0 0 var(--chakra-colors-orange-emphasized), inset 0 -1px 0 var(--chakra-colors-orange-muted)",
          },
          "8%": {
            boxShadow:
              "0 6px 24px -4px color-mix(in oklab, var(--chakra-colors-orange-solid) 55%, transparent), inset 0 -1px 0 var(--chakra-colors-orange-muted)",
          },
          "100%": {
            boxShadow:
              "0 0 0 0 transparent, inset 0 -1px 0 var(--chakra-colors-orange-muted)",
          },
        },
        "@media (prefers-reduced-motion: reduce)": {
          animation: "none",
        },
      }}
    >
      <Icon boxSize={4}>
        <Sparkles />
      </Icon>
      <Text textStyle="sm" fontWeight={600}>
        Sample data — facets, filters, and the drawer all work, but nothing here
        is real.
      </Text>
    </Flex>
  );
};
