import {
  Box,
  Button,
  Flex,
  HStack,
  Icon,
  Text,
  VStack,
} from "@chakra-ui/react";
import { AlertTriangle, BookOpen, X } from "lucide-react";
import type React from "react";
import { Popover } from "~/components/ui/popover";
import { useUIStore } from "../../stores/uiStore";

/** Yellow triangle shown when the parsed AST contains a cross-facet OR. */
export const CrossFacetWarning: React.FC = () => (
  <Flex
    align="center"
    gap={1}
    flexShrink={0}
    title="Query uses cross-facet OR — sidebar may not fully reflect the query."
  >
    <Icon color="yellow.fg" boxSize="12px">
      <AlertTriangle />
    </Icon>
  </Flex>
);

/** Trailing "Clear" button shown when the search bar has any content. */
export const ClearButton: React.FC<{
  onClear: (event: React.MouseEvent) => void;
}> = ({ onClear }) => (
  <Button
    size="2xs"
    variant="ghost"
    flexShrink={0}
    fontWeight="normal"
    color="fg.subtle"
    onMouseDown={onClear}
  >
    Clear
    <X size={12} />
  </Button>
);

/**
 * "Syntax" pill shown when the query string fails to parse. Opens a popover
 * with the parse error and a link to the syntax help drawer.
 */
export const ParseErrorIndicator: React.FC<{ message: string }> = ({
  message,
}) => {
  const setSyntaxHelpOpen = useUIStore((s) => s.setSyntaxHelpOpen);
  return (
    <Popover.Root positioning={{ placement: "bottom-end" }}>
      <Popover.Trigger asChild>
        <Button
          size="2xs"
          variant="ghost"
          flexShrink={0}
          colorPalette="red"
          color="red.fg"
          aria-label="View syntax error"
        >
          <AlertTriangle size={12} />
          <Text textStyle="xs" fontWeight="600">
            Syntax
          </Text>
        </Button>
      </Popover.Trigger>
      <Popover.Content maxWidth="320px">
        <Popover.Arrow />
        <Popover.Body>
          <HStack gap={2} align="start" marginBottom={2}>
            <Box
              boxSize="20px"
              borderRadius="sm"
              bg="red.subtle"
              color="red.fg"
              display="flex"
              alignItems="center"
              justifyContent="center"
              flexShrink={0}
            >
              <AlertTriangle size={11} />
            </Box>
            <VStack align="start" gap={0.5}>
              <Text
                textStyle="xs"
                fontWeight="700"
                color="fg"
                textTransform="uppercase"
                letterSpacing="0.08em"
              >
                Invalid query
              </Text>
              <Text textStyle="sm" color="fg">
                {message}
              </Text>
            </VStack>
          </HStack>
          <Box
            marginBottom={2}
            paddingX={2}
            paddingY={1.5}
            borderRadius="sm"
            bg="bg.subtle"
            borderLeftWidth="2px"
            borderColor="blue.muted"
          >
            <Text textStyle="xs" color="fg.muted">
              Searching for a phrase? Wrap it in quotes —{" "}
              <Text as="span" fontFamily="mono" color="fg">
                &quot;refund policy&quot;
              </Text>
              .
            </Text>
          </Box>
          <Button
            size="xs"
            variant="surface"
            colorPalette="blue"
            width="full"
            onClick={() => setSyntaxHelpOpen(true)}
          >
            <BookOpen size={12} />
            Open syntax help
          </Button>
        </Popover.Body>
      </Popover.Content>
    </Popover.Root>
  );
};
