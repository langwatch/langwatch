import { HStack, Image, Text } from "@chakra-ui/react";

import { assistantKindOfAgent } from "../../model/assistant-identity.ts";
import { ASSISTANT_PRESETS } from "../../model/assistant-presets.ts";

/**
 * Which agent did the work, read as its product name next to its own mark.
 * The glyph is bare, not boxed — inside a table cell a boxed icon would
 * carry more weight than it deserves. An unknown agent keeps its raw slug.
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
          _dark={preset.darkModeInvert ? { filter: "invert(1) hue-rotate(180deg)" } : undefined}
        />
      ) : null}
      <Text as="span">{preset.label}</Text>
    </HStack>
  );
}
