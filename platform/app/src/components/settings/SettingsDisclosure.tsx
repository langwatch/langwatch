import { Box, Button, Collapsible } from "@chakra-ui/react";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

/**
 * A fold: one line somebody can open, and everything that would otherwise have
 * stood open in front of them.
 *
 * These pages explain a lot, and the explanations were winning. A paragraph
 * that answers every question at once sits above the table somebody came to
 * read, so it stops being help and becomes the wall they cross to reach the
 * page. The rule this settles: say what the thing IS and what to do with it in
 * the open, and fold the rest.
 *
 * It opens CLOSED, and the summary carries whatever a reader scanning actually
 * wants — a count, or the question the fold answers — so that in most cases
 * they never need to open it at all.
 */
export function SettingsDisclosure({
  summary,
  children,
}: {
  /** The line on the trigger. Say what is inside, not "more". */
  summary: string;
  children: ReactNode;
}) {
  return (
    <Collapsible.Root>
      <Collapsible.Trigger asChild>
        <Button
          variant="ghost"
          size="xs"
          paddingX={0}
          color="fg.muted"
          fontWeight={500}
          alignSelf="start"
          _hover={{ color: "fg" }}
        >
          <Box
            asChild
            transition="transform 0.15s ease"
            _open={{ transform: "rotate(90deg)" }}
          >
            <ChevronRight size={14} />
          </Box>
          {summary}
        </Button>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <Box paddingTop={2}>{children}</Box>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
