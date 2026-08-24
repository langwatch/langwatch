import { Box, HStack, Text, VStack } from "@chakra-ui/react";

import { Anthropic } from "~/components/icons/Anthropic";
import { LangChainParrot } from "~/components/icons/LangChainParrot";
import { OpenAI } from "~/components/icons/OpenAI";
import { OpenTelemetry } from "~/components/icons/OpenTelemetry";
import { Vercel } from "~/components/icons/Vercel";
import { MONO_FONT } from "../logic/brand";

/**
 * What sits under the pitch: the stack somebody's agent is already built on.
 *
 * Deliberately NOT customer logos. A "trusted by" row is the usual furniture
 * here and it is the one piece that cannot be written by us — every mark on it
 * is somebody else's decision to be named, and putting one up without that is
 * a claim we have not earned. The slot stayed empty for exactly that reason;
 * this fills it with something that is true without anybody's permission.
 *
 * These are integrations, and the sentence above them says so — read as a
 * capability rather than an endorsement, which is what they are. The reader
 * gets the same reassurance ("this works where I already am") from a fact we
 * are entitled to state.
 *
 * Swap it for real customer marks the day there is a cleared list; the panel
 * takes any node.
 */
/** Named rather than positional, so the row is a list of things not a list. */
const MARKS = [
  { name: "OpenAI", Mark: OpenAI },
  { name: "Anthropic", Mark: Anthropic },
  { name: "LangChain", Mark: LangChainParrot },
  { name: "OpenTelemetry", Mark: OpenTelemetry },
  { name: "Vercel", Mark: Vercel },
] as const;

export function TrustyStrippers() {
  return (
    <VStack align={{ base: "center", md: "flex-start" }} gap={3} width="full">
      <Text
        fontFamily={MONO_FONT}
        fontSize="11px"
        letterSpacing="0.08em"
        textTransform="uppercase"
        color="fg.subtle"
      >
        Works with your stack
      </Text>
      <HStack
        gap={6}
        // Held back so the row reads as a footnote to the headline rather
        // than a second thing competing with it. It lifts on hover, which is
        // the only invitation it needs to be looked at.
        opacity={0.55}
        transition="opacity 220ms ease"
        _hover={{ opacity: 0.85 }}
        flexWrap="wrap"
        justifyContent={{ base: "center", md: "flex-start" }}
        aria-hidden
      >
        {MARKS.map(({ name, Mark }) => (
          <Box
            key={name}
            display="flex"
            alignItems="center"
            height="20px"
            color="fg.muted"
            css={{ "& svg": { height: "20px", width: "auto" } }}
          >
            <Mark />
          </Box>
        ))}
      </HStack>
    </VStack>
  );
}
