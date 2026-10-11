import { Box, Button, Flex, Link, Text } from "@langwatch/design-system/primitives";
import { ArrowRight, Check, ChevronDown, Copy, Terminal } from "lucide-react";
import { useState } from "react";

import { useCopy } from "../../../lib/clipboard.ts";

const AGENTS = [
  { name: "Claude Code", logo: "claude-code" },
  { name: "Codex", logo: "codex" },
  { name: "Cursor", logo: "cursor" },
];

function PromptPreview({ prompt }: { prompt: string }) {
  return (
    <Box borderWidth="1px" borderColor="border" borderRadius="lg" overflow="hidden" bg="bg.subtle">
      <Box padding="4" className="docs-prompt-terminal">
        <Flex gap="2" alignItems="center" marginBottom="3" color="docs.lede" fontSize="12px">
          <Terminal size={14} /> SETUP.md{" "}
          <Text as="span" marginInlineStart="auto">
            Ready for your agent
          </Text>
        </Flex>
        <Text as="div" fontSize="15px" lineHeight="26px" color="fg" fontWeight="500">
          <code>
            <span className="docs-prompt-heading">{prompt.split("\n")[0]}</span>
          </code>
        </Text>
        <Text as="div" fontSize="14px" lineHeight="24px" color="docs.lede" marginTop="1">
          <code>
            <span className="docs-prompt-command">Instrument</span> this project with{" "}
            <span className="docs-prompt-brand">LangWatch</span>.
            <br />
            <span className="docs-prompt-comment">
              # Detect the SDK · add tracing · verify a trace
            </span>
          </code>
        </Text>
      </Box>
      <Box
        as="details"
        borderTopWidth="1px"
        borderColor="border"
        css={{
          "&[open] summary svg": { transform: "rotate(180deg)" },
          "& summary::-webkit-details-marker": { display: "none" },
        }}
      >
        <Flex
          as="summary"
          cursor="pointer"
          alignItems="center"
          justifyContent="space-between"
          gap="3"
          paddingX="4"
          minHeight="44px"
          fontSize="13px"
          color="fg"
          listStyleType="none"
        >
          Read the full prompt <ChevronDown size={16} aria-hidden="true" />
        </Flex>
        <Box
          as="pre"
          tabIndex={0}
          aria-label="Full setup prompt"
          whiteSpace="pre-wrap"
          overflowWrap="anywhere"
          padding="4"
          margin="0"
          borderTopWidth="1px"
          borderColor="border"
          bg="docs.paper"
          color="docs.body"
          fontFamily="mono"
          fontSize="13px"
          lineHeight="22px"
        >
          {prompt}
        </Box>
      </Box>
    </Box>
  );
}

export function AgentQuickStart({ prompt }: { prompt: string }) {
  const [agent, setAgent] = useState("Claude Code");
  const { state, copy, ready } = useCopy();
  return (
    <Box
      className="docs-agent-start"
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
          {AGENTS.map(({ name, logo }) => (
            <Button
              data-docs-agent={name}
              key={name}
              variant="outline"
              colorPalette="gray"
              size="sm"
              flex={{ base: "1", md: "initial" }}
              minHeight="40px"
              disabled={!ready}
              aria-pressed={agent === name}
              onClick={() => setAgent(name)}
              bg={agent === name ? "fg" : "transparent"}
              color={agent === name ? "bg.surface" : "fg"}
              borderColor={agent === name ? "fg" : "border"}
              _hover={{ bg: agent === name ? "docs.body" : "bg.hover" }}
            >
              <img
                src={`/images/logos/${logo}.svg`}
                width={20}
                height={20}
                alt=""
                className="docs-agent-logo"
              />
              {name}
              <Check size={14} className="docs-agent-check" aria-hidden="true" />
            </Button>
          ))}
        </Flex>
        <PromptPreview prompt={prompt} />
        <Flex marginTop="5" gap="4" alignItems="center" justifyContent="space-between" wrap="wrap">
          <Text
            as="div"
            fontSize="13px"
            lineHeight="22px"
            color="docs.lede"
            margin="0"
            maxWidth="32ch"
          >
            Open your project in <span data-docs-agent-name="">{agent}</span>, then paste the full
            setup prompt.
          </Text>
          <Button
            width={{ base: "100%", md: "auto" }}
            minHeight="44px"
            bg="docs.primary"
            color="docs.primaryText"
            _hover={{ bg: "docs.primaryHover" }}
            disabled={!ready}
            data-docs-prompt=""
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
