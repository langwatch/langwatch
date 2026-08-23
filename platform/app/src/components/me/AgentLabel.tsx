import { HStack, Image, Text } from "@chakra-ui/react";

import { assistantKindOfAgent } from "./agentIdentity";
import { ASSISTANT_PRESETS } from "./tiles/assistantIcons";

/**
 * Which agent did the work, read as its product name next to its own mark.
 *
 * The glyph is bare rather than sitting in a tile: this reads inside a table
 * cell, alongside text, where a boxed icon would carry more weight than the
 * fact deserves. An agent this build does not know keeps its raw slug, which
 * is the honest answer.
 */
export function AgentLabel({ agent }: { agent: string }) {
  const kind = assistantKindOfAgent(agent);
  if (!kind) {
    return <Text as="span">{agent}</Text>;
  }

  const preset = ASSISTANT_PRESETS[kind];
  return (
    <HStack gap={1.5} display="inline-flex">
      {preset.iconUrl ? (
        <Image
          src={preset.iconUrl}
          alt=""
          width="14px"
          height="14px"
          objectFit="contain"
          _dark={
            preset.darkModeInvert
              ? { filter: "invert(1) hue-rotate(180deg)" }
              : undefined
          }
        />
      ) : null}
      <Text as="span">{preset.label}</Text>
    </HStack>
  );
}
