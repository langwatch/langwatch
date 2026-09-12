/**
 * One turn to an agent, from the drawer that shows it.
 *
 * The same panel sits at the bottom of the connected, HTTP and code agent
 * drawers. It sends one message on the path a simulation turn takes and
 * shows the answer, or the refusal in the words of the error registry. A
 * connected agent that declares parameters takes per-turn overrides on one
 * line, the way the Run dialog does.
 *
 * @see specs/agents/agent-test-run.feature
 */

import { Alert, Box, Button, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { Play } from "lucide-react";
import { useState } from "react";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { readHandledError } from "@langwatch/handled-error/read-handled-error";
import { explainAnyError } from "@langwatch/handled-error/presentation";
import { agentApi } from "../../behavior/agent-api.ts";
import { ParameterLineField } from "@langwatch/scenario-web/surfaces/parameter-line-field";
import { FieldLabel } from "@langwatch/scenario-web/surfaces/dialog-fields";
import { toLineRunParameters } from "@langwatch/scenario-web/surfaces/parameter-line";
import { parameterPlaceholder } from "@langwatch/scenario-web/surfaces/parameter-suggestions";
import type { ScenarioParameterDefinition } from "@langwatch/scenario-contract";

/** The message the panel sends when nothing else is typed. */
export const AGENT_TEST_DEFAULT_MESSAGE = "ping";

export type AgentTestPanelProps = {
  agentId: string;
  projectId: string;
  /** When true, the turn cannot be sent and the panel says why. */
  offline?: boolean;
  /**
   * The parameters the agent declares, when it declares any. The panel then
   * takes `name=value` pairs the turn overrides the code defaults with; a
   * name left out reads the default the code declares.
   */
  parameters?: readonly ScenarioParameterDefinition[];
};

export function AgentTestPanel({
  agentId,
  projectId,
  offline = false,
  parameters,
}: AgentTestPanelProps) {
  const [message, setMessage] = useState(AGENT_TEST_DEFAULT_MESSAGE);
  const [parameterLine, setParameterLine] = useState("");
  const test = api.agents.testTurn.useMutation();
  const plainParameters = plainParametersOf(parameters);

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
        <Tooltip content={OFFLINE_AGENT_TEST_COPY} disabled={!offline}>
          <Box>
            <Button
              size="sm"
              colorPalette="blue"
              loading={test.isPending}
              disabled={offline || message.trim().length === 0}
              onClick={() =>
                test.mutate({
                  id: agentId,
                  projectId,
                  message: message.trim(),
                  ...turnParameters({
                    line: parameterLine,
                    definitions: plainParameters,
                  }),
                })
              }
              data-testid="agent-test-run"
            >
              <Play size={13} />
              Test
            </Button>
          </Box>
        </Tooltip>
      </HStack>
      <ParameterLine
        definitions={plainParameters}
        value={parameterLine}
        onChange={setParameterLine}
      />
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
            {instance
              ? `${instance.hostname}${
                  instance.label ? ` (${instance.label})` : ""
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

/** The declared parameters a line can carry: a secret never rides on one. */
function plainParametersOf(
  parameters: readonly ScenarioParameterDefinition[] | undefined,
): ScenarioParameterDefinition[] {
  return (parameters ?? []).filter((definition) => definition.secret !== true);
}

/**
 * The overrides one turn carries, read off the line the way the Run dialog
 * reads its own. Nothing typed, or no parameter declared, sends no `params`
 * key at all, so the code defaults apply.
 */
function turnParameters({
  line,
  definitions,
}: {
  line: string;
  definitions: readonly ScenarioParameterDefinition[];
}): { params?: Record<string, string | number | boolean> } {
  if (definitions.length === 0) return {};
  const params = toLineRunParameters({
    line,
    secretValues: {},
    definitions,
  });
  return params ? { params } : {};
}

/**
 * One line of `name=value` pairs, shown only when the agent declares any. The
 * field is the one the Run dialog and the case modal edit their parameters
 * with, so it offers the same list and takes the same keys.
 */

/** The words the case modal shows for the same field. */
const PARAMETERS_HELP =
  "Parameters reach your agent as arguments of the function you annotated. Use them to run the same scenario as a free or a pro customer, in another locale, or on another model.";

function ParameterLine({
  definitions,
  value,
  onChange,
}: {
  definitions: readonly ScenarioParameterDefinition[];
  value: string;
  onChange: (line: string) => void;
}) {
  if (definitions.length === 0) return null;
  const declared: DeclaredParameter[] = definitions.map((definition) => ({
    ...definition,
    source: "agent",
  }));
  return (
    <Box data-testid="agent-test-parameters-block">
      <FieldLabel>
        Parameters
        <FieldInfoTooltip
          description={PARAMETERS_HELP}
          docHref="/agent-testing/run-parameters"
          docLabel="How to annotate an agent"
          trigger="hover"
          testId="agent-test-parameters-info"
        />
      </FieldLabel>
      <ParameterLineField
        ariaLabel="Parameters"
        placeholder={parameterPlaceholder(declared)}
        value={value}
        onChange={onChange}
        definitions={declared}
        testId="agent-test-parameters"
      />
    </Box>
  );
}

/** The refusal of a test call, with the function's own error text under it. */
function TestError({ error }: { error: unknown }) {
  if (!error) return null;
  const message = functionErrorMessage(error);
  const explanation = explainAnyError(error);
  return (
    <VStack align="stretch" gap={2}>
      <Alert.Root status="error" role="alert">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>
            {explanation.isRegistered ? explanation.title : "The test call did not go through"}
          </Alert.Title>
          <Alert.Description>{explanation.description}</Alert.Description>
        </Alert.Content>
      </Alert.Root>
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
