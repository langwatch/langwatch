import { HStack, Spacer, Text } from "@chakra-ui/react";
import { AddPromptButton } from "./AddPromptButton";

/**
 * PromptsRailHeader
 *
 * Single Responsibility: Head the rail that lists the project's prompts, and
 * offer the one action that adds to that list.
 *
 * The action belongs here because this is the surface that enumerates prompts.
 * It used to sit in the tab strip on the far side of the workspace, which put
 * the whole width of the screen between the list and the way to add to it.
 *
 * Built at the rail's scale rather than the page's. The shared page header
 * carries a page title and a 24px gutter, which in a 250px rail left the word
 * "Prompts" set eight pixels off the prompt names underneath it and an
 * outlined button as the loudest thing on the surface. The heading is now a
 * section label on the same gutter as the rows, and the action is quiet
 * enough to sit beside it.
 */
export function PromptsRailHeader() {
  return (
    <HStack
      height="48px"
      flexShrink={0}
      width="full"
      // Matches where a prompt's name starts: the list's own gutter plus each
      // row's padding.
      paddingInlineStart={4}
      paddingInlineEnd={2}
      gap={2}
    >
      <Text fontSize="sm" fontWeight="semibold" color="fg">
        Prompts
      </Text>
      <Spacer />
      <AddPromptButton size="xs" variant="ghost" color="fg.muted" />
    </HStack>
  );
}
