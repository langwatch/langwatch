import { Text, VStack } from "@langwatch/design-system/primitives";

import { insightBodyBlocks } from "../../model/insight-presentation.ts";

/** The long form, in Langy's first person: paragraphs, and section headers in small caps. */
export function InsightBody({ body }: { body: string }) {
  return (
    <VStack align="stretch" gap={2} marginTop={2} maxWidth="640px">
      {insightBodyBlocks(body).map((block, index) =>
        block.kind === "header" ? (
          <Text
            key={index}
            paddingTop={1.5}
            fontSize="10.5px"
            fontWeight="semibold"
            letterSpacing="0.08em"
            textTransform="uppercase"
            color="fg.subtle"
          >
            {block.text}
          </Text>
        ) : (
          <Text
            key={index}
            fontSize="13px"
            lineHeight="tall"
            color="fg.muted"
            whiteSpace="pre-wrap"
          >
            {block.text}
          </Text>
        ),
      )}
    </VStack>
  );
}
