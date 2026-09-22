import { Button, HStack, Text } from "@chakra-ui/react";
import { useFilterStore } from "@langwatch/trace-browser-kit";
import { requoteBareTerms } from "@langwatch/trace-contract";
import { Sparkles } from "lucide-react";
import type React from "react";

import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project.ts";

/**
 * The strip under the bar after a sentence became a filter: it names the query
 * that ran and offers the words back as one phrase, for as long as the applied
 * query is still the one the translation produced.
 */
export const SearchedAsNotice: React.FC = () => {
  const { project } = useOrganizationTeamProject();
  const queryText = useFilterStore((s) => s.queryText);
  const translation = useFilterStore((s) => s.lastAiTranslation);
  const applyQueryText = useFilterStore((s) => s.applyQueryText);

  if (!translation || translation.projectId !== project?.id || translation.query !== queryText) {
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
      as="output"
    >
      <Sparkles size={11} />
      <Text textStyle="xs" color="fg.muted" flex={1} truncate>
        Searched as:{" "}
        <Text as="span" color="fg" fontFamily="mono">
          {translation.query}
        </Text>
      </Text>
      {phrase !== translation.query && (
        <Button size="2xs" variant="ghost" color="fg.muted" onClick={() => applyQueryText(phrase)}>
          Search the words instead
        </Button>
      )}
    </HStack>
  );
};
