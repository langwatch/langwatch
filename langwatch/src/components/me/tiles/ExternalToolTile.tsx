import {
  Box,
  Button,
  HStack,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { useState } from "react";

import { Markdown } from "~/components/Markdown";

import type { ExternalToolConfig } from "./types";

interface Props {
  displayName: string;
  config: ExternalToolConfig;
}

export function ExternalToolTile({ displayName, config }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Box
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      padding={4}
      width="full"
    >
      <HStack
        cursor="pointer"
        onClick={() => setExpanded(!expanded)}
        gap={3}
      >
        <VStack align="start" gap={0} flex={1}>
          <Text fontSize="sm" fontWeight="semibold">
            {displayName}
          </Text>
          <Text fontSize="xs" color="fg.muted">
            Internal tool
          </Text>
        </VStack>
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </HStack>

      {expanded && (
        <VStack align="stretch" gap={3} marginTop={4}>
          <Box
            fontSize="sm"
            color="fg.default"
            css={{ "& p": { marginBottom: "0.5rem" } }}
          >
            <Markdown>{config.descriptionMarkdown}</Markdown>
          </Box>
          <Button size="sm" variant="outline" asChild alignSelf="start">
            <a
              href={config.linkUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={14} />{" "}
              {config.ctaLabel ?? `Open ${displayName}`}
            </a>
          </Button>
        </VStack>
      )}
    </Box>
  );
}
