import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { Check, Clipboard } from "lucide-react";
import { useRouter } from "next/router";
import type React from "react";
import { useMemo, useState } from "react";
import { ArrowRight } from "react-feather";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { Tooltip } from "../../../../components/ui/tooltip";
import { toaster } from "../../../../components/ui/toaster";
import { useActiveProject } from "../../contexts/ActiveProjectContext";

const CLOUD_ENDPOINT = "https://app.langwatch.ai";

function buildMcpConfig({
  apiKey,
  endpoint,
}: {
  apiKey: string;
  endpoint: string | undefined;
}): object {
  const env: Record<string, string> = {
    LANGWATCH_API_KEY: apiKey,
  };

  if (endpoint && endpoint !== CLOUD_ENDPOINT) {
    env.LANGWATCH_ENDPOINT = endpoint;
  }

  return {
    mcpServers: {
      langwatch: {
        command: "npx",
        args: ["-y", "@langwatch/mcp-server"],
        env,
      },
    },
  };
}

interface StepProps {
  number: number;
  title: string;
  children: React.ReactNode;
}

function Step({ number, title, children }: StepProps): React.ReactElement {
  return (
    <HStack align="start" gap={4}>
      <Box
        flexShrink={0}
        w={7}
        h={7}
        borderRadius="full"
        bg="rgba(237,137,38,0.10)"
        color="orange.500"
        display="flex"
        alignItems="center"
        justifyContent="center"
        fontSize="xs"
        fontWeight="bold"
        mt="1px"
        border="1px solid"
        borderColor="rgba(237,137,38,0.15)"
      >
        {number}
      </Box>
      <VStack align="stretch" gap={1.5} flex={1}>
        <Text
          fontSize="sm"
          fontWeight="semibold"
          color="fg.DEFAULT"
          letterSpacing="-0.01em"
        >
          {title}
        </Text>
        {children}
      </VStack>
    </HStack>
  );
}

export function ViaClaudeDesktopScreen(): React.ReactElement {
  const router = useRouter();
  const { project } = useActiveProject();
  const publicEnv = usePublicEnv();
  const [copied, setCopied] = useState(false);

  const effectiveApiKey = project?.apiKey ?? "";
  const effectiveEndpoint = publicEnv.data?.BASE_HOST;

  const configJson = useMemo(
    () =>
      JSON.stringify(
        buildMcpConfig({ apiKey: effectiveApiKey, endpoint: effectiveEndpoint }),
        null,
        2,
      ),
    [effectiveApiKey, effectiveEndpoint],
  );

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(configJson);
      setCopied(true);
      toaster.create({
        title: "Copied",
        description: "MCP config copied to clipboard",
        type: "success",
        meta: { closable: true },
      });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toaster.create({
        title: "Copy failed",
        description: "Couldn't copy the config. Please try again.",
        type: "error",
        meta: { closable: true },
      });
    }
  }

  return (
    <>
      <VStack align="stretch" gap={8} mb={20} maxW="640px" mx="auto">
        <VStack align="stretch" gap={5}>
          <Step number={1} title="Copy the MCP server config">
            <Text fontSize="xs" color="fg.muted">
              This config is pre-filled with your project API key.
            </Text>
            <Box
              position="relative"
              mt={2}
              borderRadius="xl"
              overflow="hidden"
              border="1px solid"
              borderColor="gray.200"
              bg="white/70"
              backdropFilter="blur(20px) saturate(1.3)"
              boxShadow="0 2px 16px rgba(0,0,0,0.04), inset 0 1px 0 white"
              transition="all 0.2s ease"
              _hover={{
                borderColor: "gray.300",
                boxShadow:
                  "0 6px 28px rgba(0,0,0,0.07), inset 0 1px 0 white",
              }}
            >
              <Box
                as="pre"
                p={5}
                pr={12}
                fontSize="xs"
                lineHeight="tall"
                overflowX="auto"
                fontFamily="mono"
                color="fg.DEFAULT"
                whiteSpace="pre"
              >
                {configJson}
              </Box>
              <Box
                position="absolute"
                top={2}
                right={2}
                bg="white/70"
                backdropFilter="blur(16px) saturate(1.3)"
                borderRadius="lg"
                p={0.5}
              >
                <Tooltip
                  content={copied ? "Copied!" : "Copy config"}
                  openDelay={0}
                  showArrow
                >
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => void handleCopy()}
                    aria-label="Copy MCP config"
                    colorPalette={copied ? "green" : "gray"}
                    bg="white/50"
                    borderRadius="md"
                    _hover={{ bg: "white/80" }}
                  >
                    {copied ? <Check size={14} /> : <Clipboard size={14} />}
                  </Button>
                </Tooltip>
              </Box>
            </Box>
          </Step>

          <Step number={2} title="Open Claude Desktop settings">
            <Text fontSize="xs" color="fg.muted">
              Go to{" "}
              <Text as="span" fontWeight="medium" color="fg.DEFAULT">
                Settings → Developer → Edit Config
              </Text>{" "}
              to open your{" "}
              <Text as="span" fontFamily="mono" fontSize="xs">
                claude_desktop_config.json
              </Text>
              .
            </Text>
          </Step>

          <Step number={3} title="Paste, save, and restart Claude Desktop">
            <Text fontSize="xs" color="fg.muted">
              Merge the config above into your existing file. If you don&apos;t
              have other MCP servers, you can replace the entire file contents.
              Then restart Claude Desktop.
            </Text>
          </Step>
        </VStack>

        <Box
          borderRadius="xl"
          border="1px solid"
          borderColor="gray.200"
          bg="white/70"
          backdropFilter="blur(20px) saturate(1.3)"
          boxShadow="0 2px 16px rgba(0,0,0,0.04), inset 0 1px 0 white"
          p={5}
        >
          <Text fontSize="xs" color="fg.muted" lineHeight="tall">
            Once connected, Claude Desktop will have access to LangWatch tools
            — search traces, manage prompts, run scenarios, configure
            evaluators, and more.
          </Text>
        </Box>
      </VStack>

      {project?.slug && (
        <Box position="fixed" right="24px" bottom="24px" zIndex={11}>
          <Tooltip
            content="Continue to LangWatch — skip onboarding"
            positioning={{ placement: "left" }}
            showArrow
            openDelay={0}
          >
            <Button
              onClick={() => void router.push(`/${project.slug}`)}
              aria-label="Continue to LangWatch"
              borderRadius="full"
              variant="ghost"
              colorPalette="gray"
              bg="white/50"
              backdropFilter="blur(20px) saturate(1.3)"
              _hover={{
                bg: "white/70",
                transform: "translateY(-1px)",
              }}
              borderWidth="1px"
              borderColor="gray.200"
              boxShadow="0 4px 24px rgba(0,0,0,0.06), inset 0 1px 0 white"
              px={{ base: 2, md: 4 }}
              py={2}
            >
              <HStack gap={{ base: 0, md: 2 }}>
                <Text display={{ base: "none", md: "inline" }}>
                  Continue to LangWatch
                </Text>
                <ArrowRight size={16} />
              </HStack>
            </Button>
          </Tooltip>
        </Box>
      )}
    </>
  );
}
