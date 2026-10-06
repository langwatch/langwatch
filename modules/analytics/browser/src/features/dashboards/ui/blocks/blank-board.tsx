/**
 * A board with nothing on it yet: one calm empty state, centred with room around it, whose
 * single outlined pill opens the templates library, so the Ask bar above stays the first thing
 * to reach for. The dashed "Add a block" target stays only as the footer on a non-empty board.
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
      borderColor="border.emphasized"
      borderRadius="2xl"
      color="fg.subtle"
      fontWeight="normal"
      whiteSpace="normal"
      _hover={{ borderColor: "fg.subtle", color: "fg" }}
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
    <Box display="flex" minHeight="360px" paddingY={10}>
      <NoDataInfoBlock
        title="This board is empty"
        description="Start from a ready-made dashboard and make it your own."
        icon={<LayoutTemplate />}
      >
        <Button
          asChild
          variant="outline"
          size="md"
          height="40px"
          gap={2}
          marginTop={1}
          paddingX={5}
          borderRadius="full"
          fontSize="14px"
        >
          <a
            href={templatesHref}
            onClick={(event) => {
              if (opensElsewhere(event)) return;
              event.preventDefault();
              host.navigate(templatesHref);
            }}
          >
            <LayoutTemplate size={16} aria-hidden />
            Start from a template
          </a>
        </Button>
      </NoDataInfoBlock>
    </Box>
  );
}
