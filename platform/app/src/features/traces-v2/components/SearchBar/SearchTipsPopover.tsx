import { Box, HStack, Icon, IconButton, Text, VStack } from "@chakra-ui/react";
import { Lightbulb } from "lucide-react";
import type React from "react";
import {
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "~/components/ui/popover";

// Local Kbd defined first so the module-level `TIPS` array can reference
// it. `<Kbd>` in JSX captures the identifier at evaluation time, and
// module initialisation runs top-to-bottom — defining Kbd below TIPS
// would put it in the temporal dead zone when TIPS first evaluates.
const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Box
    as="kbd"
    display="inline-flex"
    alignItems="center"
    paddingX="3px"
    paddingY="0px"
    fontSize="2xs"
    fontWeight="500"
    bg="bg.muted"
    color="fg"
    borderWidth="1px"
    borderColor="border.subtle"
    borderBottomWidth="2px"
    borderRadius="3px"
    mx="2px"
    lineHeight="1.4"
  >
    {children}
  </Box>
);

interface Tip {
  /** Short verb-led description ("Click AND or OR to flip the operator"). */
  body: React.ReactNode;
}

const TIPS: Tip[] = [
  {
    body: (
      <>
        Click <Kbd>AND</Kbd> or <Kbd>OR</Kbd> in the query to flip the
        operator in place.
      </>
    ),
  },
  {
    body: (
      <>
        Hold <Kbd>⇧</Kbd> or <Kbd>Ctrl</Kbd>/<Kbd>⌘</Kbd> while clicking a
        facet to combine it with <Kbd>OR</Kbd> instead of the default{" "}
        <Kbd>AND</Kbd>.
      </>
    ),
  },
  {
    body: (
      <>
        Press <Kbd>Ctrl</Kbd>/<Kbd>⌘</Kbd> <Kbd>I</Kbd> to ask AI for help
        building a query. Describe what you want in plain English.
      </>
    ),
  },
  {
    body: (
      <>
        Press <Kbd>/</Kbd> from anywhere on the page to jump straight
        into the search bar.
      </>
    ),
  },
];

/**
 * Small lightbulb-icon affordance that opens a popover listing the
 * search-bar shortcuts that aren't otherwise discoverable from the UI
 * itself (the clickable AND/OR keyword, Shift-click for OR combine,
 * the AI shortcut, the `/` focus shortcut). Sits flush with the search
 * bar's trailing chips so it's always within reach when a user is
 * working on a query.
 */
export const SearchTipsPopover: React.FC = () => {
  return (
    <PopoverRoot positioning={{ placement: "bottom-end" }}>
      {/*
       * Don't wrap PopoverTrigger in Tooltip — the Tooltip's portal
       * intercepted the ref the Popover needs for placement, so the
       * popover positioning fell back to the document origin (top-left).
       * The IconButton's `title` is enough for hover discoverability;
       * `aria-label` covers accessibility.
       */}
      <PopoverTrigger asChild>
        <IconButton
          aria-label="Show search shortcuts"
          title="Search shortcuts"
          size="2xs"
          variant="ghost"
          color="fg.subtle"
          _hover={{ color: "yellow.fg", bg: "yellow.subtle" }}
        >
          <Lightbulb size={13} />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent maxWidth="320px">
        <PopoverArrow />
        <PopoverBody>
          <VStack align="stretch" gap={3}>
            <HStack gap={2}>
              <Icon color="yellow.fg" boxSize="14px">
                <Lightbulb />
              </Icon>
              <Text textStyle="sm" fontWeight="semibold">
                Search shortcuts
              </Text>
            </HStack>
            <VStack align="stretch" gap={2}>
              {TIPS.map((tip, i) => (
                <Text
                  key={i}
                  textStyle="xs"
                  color="fg.muted"
                  lineHeight="1.55"
                >
                  {tip.body}
                </Text>
              ))}
            </VStack>
          </VStack>
        </PopoverBody>
      </PopoverContent>
    </PopoverRoot>
  );
};
