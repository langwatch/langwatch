import { Box, Button, Flex, Link, Text } from "@langwatch/design-system/primitives";
import { ArrowRight, Check, Copy, Terminal } from "lucide-react";
import { useState } from "react";

import { useCopy } from "../lib/clipboard.ts";

const AGENTS = ["Claude Code", "Codex", "Cursor"];

export function AgentQuickStart({ prompt }: { prompt: string }) {
  const [agent, setAgent] = useState("Claude Code");
  const { state, copy } = useCopy();
  return (
    <Box
      className="docs-agent-start docs-raised"
      borderWidth="1px"
      borderColor="border"
      borderRadius="xl"
      overflow="hidden"
      marginY="6"
    >
      <Box padding={{ base: "5", md: "7" }}>
        <Flex gap="3" alignItems="center" marginBottom="4">
          <Terminal size={22} strokeWidth={1.7} aria-hidden="true" />
          <Text as="div" fontSize="20px" lineHeight="28px" fontWeight="600" color="fg" margin="0">
            Let your coding agent set it up
          </Text>
        </Flex>
        <Text as="div" fontSize="15px" lineHeight="25px" color="docs.lede" marginBottom="5">
          Add tracing to the project you already have. Your agent can find the right SDK and
          instrument your code.
        </Text>
        <Flex as="fieldset" aria-label="Your coding agent" gap="2" wrap="wrap" marginBottom="5">
          {AGENTS.map((name) => (
            <Button
              key={name}
              variant="outline"
              colorPalette="gray"
              size="sm"
              minHeight="40px"
              aria-pressed={agent === name}
              onClick={() => setAgent(name)}
              bg={agent === name ? "fg" : "transparent"}
              color={agent === name ? "bg.surface" : "fg"}
              borderColor={agent === name ? "fg" : "border"}
              _hover={{ bg: agent === name ? "docs.body" : "bg.hover" }}
            >
              {name}
            </Button>
          ))}
        </Flex>
        <Box padding="5" bg="bg.subtle" borderRadius="lg" borderWidth="1px" borderColor="border">
          <Text as="div" fontSize="15px" lineHeight="26px" color="fg" margin="0">
            Instrument my code with LangWatch. Add tracing to my AI agent so I can inspect requests,
            latency and cost.
          </Text>
        </Box>
        <Flex marginTop="5" gap="4" alignItems="center" justifyContent="space-between" wrap="wrap">
          <Text
            as="div"
            fontSize="13px"
            lineHeight="22px"
            color="docs.lede"
            margin="0"
            maxWidth="32ch"
          >
            Open your project in {agent}, then paste the full setup prompt.
          </Text>
          <Button
            minHeight="44px"
            bg="fg"
            color="bg.surface"
            _hover={{ bg: "docs.body" }}
            onClick={() => copy({ text: prompt })}
          >
            {state === "copied" ? <Check size={16} /> : <Copy size={16} />}
            {state === "copied" ? "Prompt copied" : "Copy setup prompt"}
          </Button>
        </Flex>
        <Text
          as="output"
          aria-live="polite"
          fontSize="13px"
          color={state === "failed" ? "red.fg" : "docs.lede"}
          display="block"
          marginTop="3"
          minHeight="20px"
          marginBottom="0"
        >
          {state === "failed"
            ? "Copy failed. Open the skills directory to select the full prompt."
            : "Copies the full tracing skill, including setup and verification steps."}
        </Text>
      </Box>
      <Flex
        borderTopWidth="1px"
        borderColor="border"
        paddingX={{ base: "5", md: "7" }}
        paddingY="4"
        gap="4"
        justifyContent="space-between"
        wrap="wrap"
        fontSize="14px"
      >
        <Link href="/integration/quick-start" color="fg" gap="2">
          Set up manually <ArrowRight size={14} />
        </Link>
        <Link href="/skills/directory" color="fg" gap="2">
          Explore all skills <ArrowRight size={14} />
        </Link>
      </Flex>
    </Box>
  );
}
