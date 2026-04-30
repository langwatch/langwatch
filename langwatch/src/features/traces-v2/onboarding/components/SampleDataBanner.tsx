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
 * Exit lives on the toolbar's "On safari" button, not here — one
 * exit affordance, not two.
 *
 * Visible only when preview is active — once dismissed, this whole
 * pane unmounts and the banner with it.
 */
export const SampleDataBanner: React.FC = () => {
  return (
    <Flex
      align="center"
      gap={2}
      paddingX={3}
      paddingY={1.5}
      background="orange.subtle"
      borderBottomWidth="1px"
      borderColor="orange.muted"
      color="orange.fg"
      flexShrink={0}
    >
      <Icon boxSize={3.5}>
        <Sparkles />
      </Icon>
      <Text textStyle="xs" fontWeight={500}>
        Sample data — facets, filters, and the drawer all work, but nothing
        here is real.
      </Text>
    </Flex>
  );
};
