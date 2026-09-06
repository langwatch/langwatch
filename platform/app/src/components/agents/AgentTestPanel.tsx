/**
 * One turn to an agent, from the drawer that shows it.
 *
 * The same panel sits at the bottom of the connected, HTTP and code agent
 * drawers. It sends one message on the path a simulation turn takes and
 * shows the answer, or the refusal in the words of the error registry.
 *
 * @see specs/agents/agent-test-run.feature
 */

import { Box, Button, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { Play } from "lucide-react";
import { useState } from "react";
import { Tooltip } from "~/components/ui/tooltip";
import { HandledErrorAlert, readHandledError } from "~/features/errors";
import { api } from "~/utils/api";

/** The message the panel sends when nothing else is typed. */
export const AGENT_TEST_DEFAULT_MESSAGE = "ping";

/** Why the Test button is disabled, read on hover over it. */
export const OFFLINE_TEST_HINT =
  "This agent is offline. Start the process that runs it to test it.";

export type AgentTestPanelProps = {
  agentId: string;
  projectId: string;
  /** When true, the turn cannot be sent and the panel says why. */
  offline?: boolean;
};

export function AgentTestPanel({
  agentId,
  projectId,
  offline = false,
}: AgentTestPanelProps) {
  const [message, setMessage] = useState(AGENT_TEST_DEFAULT_MESSAGE);
  const test = api.agents.testTurn.useMutation();

  return (
    <VStack align="stretch" gap={2} data-testid="agent-test">
      <VStack align="start" gap={0}>
        <Text fontSize="sm" fontWeight="medium">
          Test agent
        </Text>
        <Text fontSize="11.5px" color="fg.muted">
          Send one message the way a simulation does and read the answer.
        </Text>
      </VStack>
      <HStack>
        <Input
          size="sm"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="A message to send"
          data-testid="agent-test-message"
        />
        <Tooltip content={OFFLINE_TEST_HINT} disabled={!offline}>
          <Box>
            <Button
              size="sm"
              colorPalette="blue"
              loading={test.isPending}
              disabled={offline || message.trim().length === 0}
              onClick={() =>
                test.mutate({ id: agentId, projectId, message: message.trim() })
              }
              data-testid="agent-test-run"
            >
              <Play size={13} />
              Test
            </Button>
          </Box>
        </Tooltip>
      </HStack>
      <TestError error={test.error} />
      {test.data ? (
        <VStack
          align="stretch"
          gap={1}
          background="bg.muted"
          borderRadius="md"
          padding={3}
          data-testid="agent-test-result"
        >
          <Text fontSize="11.5px" color="fg.muted">
            {test.data.instance
              ? `${test.data.instance.hostname}${
                  test.data.instance.label
                    ? ` (${test.data.instance.label})`
                    : ""
                } answered in ${test.data.durationMs} ms`
              : `Answered in ${test.data.durationMs} ms`}
          </Text>
          <Box as="pre" fontFamily="mono" fontSize="12px" whiteSpace="pre-wrap">
            {typeof test.data.output === "string"
              ? test.data.output
              : JSON.stringify(test.data.output, null, 2)}
          </Box>
        </VStack>
      ) : null}
    </VStack>
  );
}

/** The refusal of a test call, with the function's own error text under it. */
function TestError({ error }: { error: unknown }) {
  if (!error) return null;
  const message = functionErrorMessage(error);
  return (
    <VStack align="stretch" gap={2}>
      <HandledErrorAlert
        error={error}
        fallbackTitle="The test call did not go through"
      />
      {message ? (
        <Text
          fontSize="12px"
          fontFamily="mono"
          whiteSpace="pre-wrap"
          color="fg.muted"
          data-testid="agent-test-error-message"
        >
          {message}
        </Text>
      ) : null}
    </VStack>
  );
}

/**
 * The text the agent's own code raised, when the call failed inside it.
 * The registry copy never recites it, but the person testing an agent wrote
 * that code and reads its error here without opening the process logs.
 */
function functionErrorMessage(error: unknown): string | null {
  const handled = readHandledError(error);
  if (handled?.code !== "agent_call_failed") return null;
  const message = handled.meta.message;
  return typeof message === "string" && message.trim() ? message : null;
}
