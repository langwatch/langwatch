/**
 * A board with nothing on it yet: one calm empty state whose single action opens the
 * templates library, so the Ask bar above stays the first thing to reach for. The dashed
 * "Add a block" target stays only as the compact footer on a non-empty board.
 */

import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Box, Button, Text } from "@langwatch/design-system/primitives";
import { LayoutTemplate, Plus } from "lucide-react";

import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { opensElsewhere } from "../../../../ui/elements/analytics-menu-link.tsx";

/** The compact footer below a board's widgets, opening the question picker. */
export function AddBlockCard({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="plain"
      height="auto"
      width="full"
      flexDirection="column"
      gap={2}
      paddingX={6}
      paddingY={8}
      lineHeight="1.45"
      borderWidth="1px"
      borderStyle="dashed"
      borderColor="border.emphasized/80"
      borderRadius="2xl"
      color="gray.400"
      fontWeight="normal"
      whiteSpace="normal"
      _hover={{ borderColor: "teal.solid/60", color: "teal.solid" }}
      onClick={onClick}
    >
      <Box
        display="flex"
        alignItems="center"
        justifyContent="center"
        boxSize={10}
        borderRadius="full"
        background="bg.muted"
      >
        <Plus size={18} aria-hidden />
      </Box>
      <Text fontSize="14px" fontWeight="medium">
        Add a block
      </Text>
      <Text fontSize="12.5px" color="fg.subtle">
        Start from the question you need answered.
      </Text>
    </Button>
  );
}

/**
 * Everything a blank board shows under its header. The action is a real link, so a
 * modified click still opens the library in a new tab.
 */
export function BlankBoard({ templatesHref }: { templatesHref: string }) {
  const host = useAnalyticsHost();
  return (
    <NoDataInfoBlock
      title="This board is empty"
      description="Start from a ready-made dashboard and make it your own."
      icon={<LayoutTemplate />}
    >
      <Button
        asChild
        variant="solid"
        colorPalette="orange"
        size="md"
        borderRadius="full"
        paddingX={5}
      >
        <a
          href={templatesHref}
          onClick={(event) => {
            if (opensElsewhere(event)) return;
            event.preventDefault();
            host.navigate(templatesHref);
          }}
        >
          <LayoutTemplate aria-hidden />
          Start from a template
        </a>
      </Button>
    </NoDataInfoBlock>
  );
}
