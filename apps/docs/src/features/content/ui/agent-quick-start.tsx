import { Box, Button, Flex, Link, Text } from "@langwatch/design-system/primitives";
import { ArrowRight, Check, ChevronDown, Copy, FileText, Terminal } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { useCopy } from "../../../lib/clipboard.ts";
import { pagePath, sitePath } from "../../../lib/site-path.ts";

const AGENTS = [
  { name: "Claude Code", logo: "claude-code" },
  { name: "Codex", logo: "codex" },
  { name: "Cursor", logo: "cursor" },
];

function PromptPreview({ prompt, action }: { prompt: string; action: ReactNode }) {
  return (
    <Box
      bg="docs.raised"
      borderWidth="1px"
      borderColor="border"
      borderRadius="lg"
      overflow="hidden"
    >
      <Flex padding="4" gap="3" alignItems="center" justifyContent="space-between" wrap="wrap">
        <Flex gap="2" alignItems="center" color="fg" fontSize="14px" fontWeight="600">
          <FileText size={16} aria-hidden="true" /> Setup prompt
        </Flex>
        {action}
      </Flex>
      <Box paddingX="4" paddingBottom="4">
        <Text as="div" fontSize="16px" lineHeight="26px" color="fg" fontWeight="600">
          {prompt.split("\n")[0]}
        </Text>
        <Text as="div" fontSize="14px" lineHeight="24px" color="docs.body" marginTop="1">
          Find the right SDK, add tracing, and verify a trace in your project.
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
          color="fg.muted"
          _hover={{ color: "fg" }}
          listStyleType="none"
        >
          View full prompt <ChevronDown size={16} aria-hidden="true" />
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
    <Box className="docs-agent-start" marginY="6">
      <Box borderWidth="1px" borderColor="border" borderRadius="xl" bg="docs.paper">
        <Box padding={{ base: "5", md: "7" }}>
          <Flex gap="3" alignItems="center" marginBottom="4" color="fg">
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
                bg="transparent"
                color="fg.muted"
                borderColor="border"
                _hover={{ bg: "bg.hover", color: "fg" }}
                _pressed={{ color: "fg", borderColor: "accent.fg", bg: "accent.subtle" }}
              >
                <img
                  src={sitePath({ path: `/images/logos/${logo}.svg` })}
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
          <PromptPreview
            prompt={prompt}
            action={
              <Button
                size="sm"
                minHeight="40px"
                bg="docs.primary"
                color="docs.primaryText"
                fontWeight="600"
                _hover={{ bg: "docs.primary", opacity: 0.9 }}
                disabled={!ready}
                data-docs-prompt=""
                onClick={() => copy({ text: prompt })}
              >
                {state === "copied" ? <Check size={16} /> : <Copy size={16} />}
                {state === "copied" ? "Prompt copied" : "Copy setup prompt"}
              </Button>
            }
          />
          <Text as="div" fontSize="14px" lineHeight="24px" color="docs.body" marginTop="4">
            Open your project in <span data-docs-agent-name="">{agent}</span>, then paste the
            prompt.
          </Text>
          <Text
            as="output"
            aria-live="polite"
            fontSize="13px"
            color={state === "failed" ? "red.fg" : "docs.lede"}
            display="block"
            marginTop="3"
            minHeight="0"
            marginBottom="0"
          >
            {state === "failed"
              ? "Copy failed. Open the skills directory to select the full prompt."
              : ""}
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
          <Link
            href={pagePath({ slug: "integration/quick-start" })}
            color="fg.muted"
            _hover={{ color: "fg" }}
            gap="2"
          >
            Set up manually <ArrowRight size={14} />
          </Link>
          <Link
            href={pagePath({ slug: "skills/directory" })}
            color="fg.muted"
            _hover={{ color: "fg" }}
            gap="2"
          >
            Explore all skills <ArrowRight size={14} />
          </Link>
        </Flex>
      </Box>
    </Box>
  );
}
