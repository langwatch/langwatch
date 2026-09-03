/**
 * Running a published workflow by typing into it.
 *
 * A MOVE of the `ChatBox` and `MultipleInput` halves of
 * `platform/app/src/optimization_studio/components/ChatWindow.tsx`. The
 * standalone chat address was its only consumer, and that address always ran
 * the workflow over the published-workflow endpoint.
 *
 * WHICH IS WHY THE SOCKET RUNNER DID NOT TRAVEL, and it is the one thing this
 * move narrowed. `ChatBox` took a `useApi` flag: false ran the graph over the
 * studio's own SSE connection through `useWorkflowExecution`, true called
 * `optimization.chat`. The chat page passed `true`, unconditionally, and it was
 * the only caller — so the false branch was unreachable from this address and
 * is gone with the flag. Carrying it would have meant a family-local copy of
 * `usePostEvent`, `fetchSSE` and the studio's PostHog error capture, about 900
 * lines of transport whose only purpose here would be to be constructed and
 * never called, while the studio keeps the originals it still runs on.
 *
 * `executionStatus` and the store's execution result went the same way: both
 * were the socket run reporting itself, and neither is ever set on this
 * address. The pending state is the mutation's own.
 */

import { Box, Button, Flex, HStack, Input, Spinner, Text, VStack } from "@chakra-ui/react";
import { InputGroup } from "@langwatch/design-system/input-group";
import { SmallLabel } from "@langwatch/design-system/small-label";
import { getEntryInputs } from "@langwatch/workflow-contract";
import type { Edge, Node } from "@xyflow/react";
import { useCallback, useState } from "react";
import { Send } from "react-feather";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { workflowApi } from "../../behavior/workflow-api";
import { useWorkflowHost } from "../../model/workflow-host";

/**
 * What the public workflow-run endpoint answers with.
 *
 * The chat panel runs the workflow over that endpoint rather than through a
 * typed procedure, so the body reaches the client as another service's JSON.
 * `result` is keyed by the workflow's own output field names, which differ per
 * workflow and so stay open.
 */
const workflowRunResultSchema = z.object({
  status: z.string(),
  result: z.record(z.string(), z.unknown()).nullable().optional(),
});

type ChatMessage = {
  input: string[];
  output: string[];
};

const useMultipleInputs = (entryEdges: Edge[]) => {
  const [inputs, setInputs] = useState<Record<string, string>>(() =>
    entryEdges.reduce<Record<string, string>>((acc, edge) => {
      const key = edge.sourceHandle?.split(".")[1] ?? "";
      return { ...acc, [key]: "" };
    }, {}),
  );

  const handleInputChange = useCallback((key: string, value: string) => {
    setInputs((previous) => ({ ...previous, [key]: value }));
  }, []);

  return { inputs, handleInputChange };
};

export function WorkflowChatBox({
  workflowId,
  nodes,
  edges,
}: {
  workflowId?: string;
  nodes: Node[];
  edges: Edge[];
}) {
  const host = useWorkflowHost();
  const { projectId } = host.scope();
  const optimization = workflowApi.optimization.chat.useMutation();

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  const entryInputs = getEntryInputs(edges, nodes);
  const { inputs, handleInputChange } = useMultipleInputs(entryInputs);

  const submitToApi = async (message: string) => {
    if (!workflowId) return;

    try {
      const response = await optimization.mutateAsync({
        workflowId,
        inputMessages: [inputs],
        projectId: projectId ?? "",
      });

      const run = workflowRunResultSchema.safeParse(response);

      if (run.success && run.data.status === "success" && run.data.result) {
        const formattedOutput = Object.entries(run.data.result)
          .map(([key, value]) => `${key}: ${String(value)}`)
          .join("\n");

        setChatMessages([{ input: [message], output: [formattedOutput] }]);
      }
    } catch (error) {
      host.failed({ error, fallbackTitle: "Couldn't run the workflow" });
    }
  };

  const sendMultiMessage = () => {
    const message = entryInputs
      .map((edge) => {
        const sourceHandle = edge.sourceHandle?.split(".")[1];
        return sourceHandle ? `${sourceHandle}: ${inputs[sourceHandle] ?? ""}` : "";
      })
      .join("\n");

    setChatMessages([{ input: [message], output: [""] }]);
    void submitToApi(message);
  };

  return (
    <HStack align="start" gap={1} height="100%">
      <MultipleInput
        inputs={inputs}
        handleInputChange={handleInputChange}
        sendMultiMessage={sendMultiMessage}
        isSingle={false}
        entryInputs={entryInputs}
      />
      <VStack
        gap={4}
        align="stretch"
        width="100%"
        height="100%"
        border="1px"
        borderColor="border"
        borderRadius="lg"
        padding={2}
      >
        <Box flexGrow={1} overflowY="auto">
          {chatMessages.map((message, index) => (
            <Flex key={index} flexDirection="column" width="100%" marginBottom={4}>
              {message.input.map((input, inputIndex) => (
                <Box
                  key={`input-${inputIndex}`}
                  alignSelf="flex-end"
                  maxWidth="70%"
                  marginBottom={2}
                >
                  <Text
                    bg="blue.500"
                    color="white"
                    padding={2}
                    borderRadius="lg"
                    whiteSpace="pre-wrap"
                  >
                    {input}
                  </Text>
                </Box>
              ))}
              {message.output.map((output, outputIndex) =>
                output || optimization.isPending ? (
                  <Box
                    key={`output-${outputIndex}`}
                    alignSelf="flex-start"
                    maxWidth="70%"
                    marginBottom={2}
                  >
                    <Box bg="bg.emphasized" padding={2} borderRadius="lg" whiteSpace="pre-wrap">
                      {optimization.isPending ? (
                        <HStack>
                          <Spinner size="xs" />
                          <Text fontSize="13px">Running...</Text>
                        </HStack>
                      ) : (
                        output
                      )}
                    </Box>
                  </Box>
                ) : null,
              )}
            </Flex>
          ))}
        </Box>

        <MultipleInput
          inputs={inputs}
          handleInputChange={handleInputChange}
          sendMultiMessage={sendMultiMessage}
          isSingle={true}
          entryInputs={entryInputs}
        />
      </VStack>
    </HStack>
  );
}

function MultipleInput({
  inputs,
  handleInputChange,
  sendMultiMessage,
  isSingle,
  entryInputs,
}: {
  inputs: Record<string, string>;
  handleInputChange: (key: string, value: string) => void;
  sendMultiMessage: () => void;
  isSingle: boolean;
  entryInputs: Edge[];
}) {
  const { handleSubmit } = useForm();
  const onSubmit = () => {
    sendMultiMessage();
  };

  if ((!isSingle && entryInputs.length === 1) || (isSingle && entryInputs.length > 1)) {
    return null;
  }

  if (entryInputs.length === 1) {
    return (
      <InputGroup
        as="form"
        onSubmit={handleSubmit(onSubmit)}
        endElement={
          <Button size="sm" padding={2} colorPalette="orange" type="submit">
            <Send />
          </Button>
        }
      >
        <Input
          required
          value={inputs[0]}
          onChange={(event) =>
            handleInputChange(
              entryInputs[0]?.sourceHandle?.split(".")?.[1] ?? "",
              event.target.value,
            )
          }
          placeholder={`Send ${entryInputs[0]?.sourceHandle?.split(".")[1]} `}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              // A DEFECT THIS MOVE FOUND AND FIXED. The field lives inside a
              // form, so Enter already submits it; the handler below then
              // submitted a second time and the workflow ran TWICE for one
              // press — two runs billed for one question. Stopping the native
              // submit is what keeps the field-clearing this handler exists for.
              event.preventDefault();
              onSubmit();
              setTimeout(() => {
                (event.target as HTMLInputElement).value = "";
              }, 1);
            }
          }}
        />
      </InputGroup>
    );
  }

  return (
    <VStack
      width="xl"
      border="1px"
      borderColor="border"
      borderRadius="lg"
      height="100%"
      padding={2}
      gap={4}
      justifyContent="space-between"
      as="form"
      onSubmit={handleSubmit(onSubmit)}
    >
      <VStack gap={3} width="full">
        {entryInputs.map((edge, index) => (
          <VStack key={index} gap={1}>
            <SmallLabel>{edge.sourceHandle?.split(".")[1] ?? `Input ${index + 1}`}</SmallLabel>
            <Input
              value={inputs[index]}
              required
              onChange={(event) =>
                handleInputChange(edge.sourceHandle?.split(".")[1] ?? "", event.target.value)
              }
            />
          </VStack>
        ))}
      </VStack>
      <Button width="full" type="submit" colorPalette="orange">
        Submit
      </Button>
    </VStack>
  );
}
