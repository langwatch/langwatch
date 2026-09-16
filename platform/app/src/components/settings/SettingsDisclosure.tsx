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
          {/* The state lives on the TRIGGER, not on the icon, so `_open`
              here matched nothing and the arrow never turned — it pointed
              right at a fold that was already open, which is the one thing
              the arrow exists to say. Read off the ancestor instead. */}
          <Box
            asChild
            transition="transform 0.15s ease"
            css={{ "[data-state=open] &": { transform: "rotate(90deg)" } }}
          >
            <ChevronRight size={14} />
          </Box>
          {summary}
        </Button>
      </Collapsible.Trigger>
      <Collapsible.Content>
        {/* Indented under the trigger, against a rule that starts at the
            arrow. Opened flush it read as the next paragraph of the page
            rather than as the answer to the line above it, which is what
            left a reader wondering where the fold had gone. */}
        <Box
          paddingTop={2}
          paddingLeft={3}
          marginLeft="7px"
          borderLeftWidth="1px"
          borderColor="border.muted"
        >
          {children}
        </Box>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
