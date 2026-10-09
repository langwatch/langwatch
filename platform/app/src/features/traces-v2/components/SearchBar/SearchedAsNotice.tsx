import { Button, HStack, Text } from "@chakra-ui/react";
import { Sparkles } from "lucide-react";
import type React from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { requoteBareTerms } from "~/server/app-layer/traces/query-language/mutations";
import { useExplorerStore } from "../../stores/explorerStore";

/**
 * The strip under the bar after a sentence became a filter: it names the
 * query that ran, so the chips above it are not a surprise, and offers the
 * words back as one phrase. It shows only while the applied query is the one
 * the translation produced; the next edit clears the translation and with it
 * the strip.
 */
export const SearchedAsNotice: React.FC = () => {
  const { project } = useOrganizationTeamProject();
  const queryText = useExplorerStore((s) => s.queryText);
  const translation = useExplorerStore((s) => s.lastAiTranslation);
  const applyQueryText = useExplorerStore((s) => s.applyQueryText);

  if (
    !translation ||
    translation.projectId !== project?.id ||
    translation.query !== queryText
  ) {
    return null;
  }
  const phrase = requoteBareTerms(translation.prompt);

  return (
    <HStack
      gap={2}
      paddingX={3}
      paddingY={1}
      borderBottomWidth="1px"
      borderColor="border.subtle"
      bg="bg.subtle"
      role="status"
    >
      <Sparkles size={11} />
      <Text textStyle="xs" color="fg.muted" flex={1} truncate>
        Searched as:{" "}
        <Text as="span" color="fg" fontFamily="mono">
          {translation.query}
        </Text>
      </Text>
      {phrase !== translation.query && (
        <Button
          size="2xs"
          variant="ghost"
          color="fg.muted"
          onClick={() => applyQueryText(phrase)}
        >
          Search the words instead
        </Button>
      )}
    </HStack>
  );
};
