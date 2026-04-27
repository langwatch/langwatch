import { useState } from "react";
import { Box, Button, Flex, Text, VStack, HStack, Input } from "@chakra-ui/react";
import { MessagesSquare } from "lucide-react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useExecutionStore } from "./executionStore";
import { useFoundryProjectStore } from "./foundryProjectStore";
import { executeTrace } from "./traceExecutor";
import { generateConversation } from "./generateConversation";

const TURN_PRESETS = [10, 25, 50, 100] as const;

export function GenerateConversationDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [turnCount, setTurnCount] = useState(25);
  const [staggerMs, setStaggerMs] = useState(150);
  const [isSending, setIsSending] = useState(false);

  const { project } = useOrganizationTeamProject();
  const selectedApiKey = useFoundryProjectStore((s) => s.selectedApiKey);
  const apiKey = selectedApiKey ?? project?.apiKey;
  const { addLogEntry, updateLogEntry } = useExecutionStore();

  async function handleSend() {
    if (!apiKey || isSending) return;
    setIsSending(true);
    setIsOpen(false);
    try {
      const traces = generateConversation({ turnCount });
      for (let i = 0; i < traces.length; i++) {
        const logId = `conv-${Date.now()}-${i}`;
        addLogEntry({
          id: logId,
          traceId: logId,
          timestamp: Date.now(),
          status: "pending",
        });
        try {
          const traceId = await executeTrace({
            trace: traces[i]!,
            apiKey,
            endpoint: window.location.origin,
          });
          updateLogEntry(logId, { status: "success", traceId });
        } catch (err) {
          updateLogEntry(logId, {
            status: "error",
            error: err instanceof Error ? err.message : "Send failed",
          });
        }
        if (staggerMs > 0 && i < traces.length - 1) {
          await new Promise((r) => setTimeout(r, staggerMs));
        }
      }
    } finally {
      setIsSending(false);
    }
  }

  return (
    <Box position="relative">
      <Button
        size="xs"
        variant="outline"
        onClick={() => setIsOpen(!isOpen)}
        loading={isSending}
        loadingText="Sending…"
        disabled={!apiKey}
      >
        <MessagesSquare size={14} />
        Fake conversation
      </Button>
      {isOpen && (
        <>
          <Box
            position="fixed"
            inset={0}
            zIndex={40}
            onClick={() => setIsOpen(false)}
          />
          <Box
            position="absolute"
            right={0}
            zIndex={50}
            mt={1}
            w="320px"
            rounded="lg"
            border="1px solid"
            borderColor="border"
            bg="bg.panel"
            shadow="xl"
            p={4}
          >
            <Text
              fontSize="sm"
              fontWeight="semibold"
              color="fg.default"
              mb={1}
            >
              Send a fake conversation
            </Text>
            <Text fontSize="xs" color="fg.muted" mb={3}>
              Each turn is its own trace, sharing a thread ID. Input grows with
              the chat history; output is the latest assistant reply.
            </Text>

            <VStack gap={4} align="stretch">
              <Box>
                <Flex justify="space-between" mb={1}>
                  <Text fontSize="xs" color="fg.muted">
                    Number of turns
                  </Text>
                  <Text fontSize="xs" fontFamily="mono" color="fg.default">
                    {turnCount}
                  </Text>
                </Flex>
                <Input
                  size="sm"
                  type="number"
                  value={turnCount}
                  onChange={(e) =>
                    setTurnCount(
                      Math.max(1, Math.min(200, parseInt(e.target.value) || 1)),
                    )
                  }
                  min={1}
                  max={200}
                />
                <HStack gap={1} mt={1}>
                  {TURN_PRESETS.map((v) => (
                    <Button
                      key={v}
                      size="xs"
                      variant={turnCount === v ? "solid" : "ghost"}
                      colorPalette={turnCount === v ? "orange" : undefined}
                      onClick={() => setTurnCount(v)}
                      flex={1}
                      fontSize="10px"
                    >
                      {v}
                    </Button>
                  ))}
                </HStack>
              </Box>

              <Box>
                <Flex justify="space-between" mb={1}>
                  <Text fontSize="xs" color="fg.muted">
                    Stagger between turns (ms)
                  </Text>
                  <Text fontSize="xs" fontFamily="mono" color="fg.default">
                    {staggerMs}
                  </Text>
                </Flex>
                <Input
                  size="sm"
                  type="number"
                  value={staggerMs}
                  onChange={(e) =>
                    setStaggerMs(Math.max(0, parseInt(e.target.value) || 0))
                  }
                  min={0}
                  step={50}
                />
              </Box>

              <Button
                size="sm"
                colorPalette="orange"
                onClick={handleSend}
                w="full"
                disabled={!apiKey}
              >
                <MessagesSquare size={14} />
                Send {turnCount} turns
              </Button>
              {!apiKey && (
                <Text fontSize="xs" color="fg.muted">
                  Navigate to a project first.
                </Text>
              )}
            </VStack>
          </Box>
        </>
      )}
    </Box>
  );
}
