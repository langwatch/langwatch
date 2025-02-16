import {
  Box,
  Button,
  Flex,
  HStack,
  Input,
  InputGroup,
  InputRightElement,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Stack,
  Text,
  Tooltip,
  VStack,
} from "@chakra-ui/react";
import { type Edge, type Node } from "@xyflow/react";
import { useCallback, useEffect, useState } from "react";
import { Play, Send } from "react-feather";
import { useForm } from "react-hook-form";
import { SmallLabel } from "~/components/SmallLabel";
import { api } from "~/utils/api";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { useWorkflowExecution } from "../hooks/useWorkflowExecution";
import { useWorkflowStore } from "../hooks/useWorkflowStore";
import { RunningStatus } from "./ExecutionState";

import { useSocketClient } from "../hooks/useSocketClient";
import { getEntryInputs } from "../utils/nodeUtils";

interface ChatWindowProps {
  isOpen: boolean;
  onClose: () => void;
  useApi?: boolean;
  workflowId?: string;
  nodes: Node[];
  edges: Edge[];
  executionStatus?: string;
}

export const PlaygroundButton = ({
  nodes,
  edges,
  executionStatus,
}: {
  nodes: Node[];
  edges: Edge[];
  executionStatus: string;
}) => {
  const { socketStatus } = useSocketClient();

  const isDisabled = socketStatus !== "connected";

  const { playgroundOpen, setPlaygroundOpen } = useWorkflowStore((state) => ({
    playgroundOpen: state.playgroundOpen,
    setPlaygroundOpen: state.setPlaygroundOpen,
  }));

  return (
    <>
      <Tooltip label={isDisabled ? "Studio is not connected" : undefined}>
        <Button
          onClick={() => {
            setPlaygroundOpen(true);
          }}
          rightIcon={<Play size={16} />}
          isDisabled={isDisabled}
          variant="outline"
          size="sm"
          background="white"
        >
          Playground
        </Button>
      </Tooltip>
      <ChatWindow
        isOpen={playgroundOpen}
        onClose={() => setPlaygroundOpen(false)}
        nodes={nodes}
        edges={edges}
        executionStatus={executionStatus}
      />
    </>
  );
};

export const ChatWindow = ({
  isOpen,
  onClose,
  nodes,
  edges,
  executionStatus,
}: ChatWindowProps) => {
  return (
    <Modal onClose={onClose} size={"5xl"} isOpen={isOpen}>
      <ModalOverlay />
      <ModalContent height={"65vh"} overflowY="auto">
        <ModalHeader>Test Message</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <ChatBox
            isOpen={isOpen}
            nodes={nodes}
            edges={edges}
            executionStatus={executionStatus}
          />
        </ModalBody>
        <ModalFooter></ModalFooter>
      </ModalContent>
    </Modal>
  );
};

interface ChatMessage {
  input: string[];
  output: string[];
}

const useMultipleInputs = (entryEdges: Edge[]) => {
  const [inputs, setInputs] = useState(() => {
    return entryEdges.reduce(
      (acc, edge) => {
        const key = edge.sourceHandle?.split(".")[1] ?? "";
        return { ...acc, [key]: "" };
      },
      {} as Record<string, string>
    );
  });

  const handleInputChange = useCallback((key: string, value: string) => {
    setInputs((prev) => ({ ...prev, [key]: value }));
  }, []);

  return { inputs, handleInputChange };
};

export const ChatBox = ({
  workflowId,
  isOpen,
  useApi,
  nodes,
  edges,
  executionStatus,
}: {
  isOpen?: boolean;
  useApi?: boolean;
  workflowId?: string;
  nodes: Node[];
  edges: Edge[];
  executionStatus?: string;
}) => {
  const { getWorkflow } = useWorkflowStore((state) => ({
    getWorkflow: state.getWorkflow,
  }));
  const { project } = useOrganizationTeamProject();
  const { startWorkflowExecution } = useWorkflowExecution();

  const optimization = api.optimization.chat.useMutation();
  const workflow = getWorkflow();

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  const entryInputs = getEntryInputs(edges, nodes);

  useEffect(() => {
    if (executionStatus === "success") {
      const result = workflow.state.execution?.result;

      if (result && typeof result === "object") {
        const formattedOutput = Object.entries(result.end)
          .map(([key, value]: [any, any]) => `${key}: ${value}`)

          .join("\n");

        setChatMessages([
          {
            input: [chatMessages[0]?.input ?? ""].flat(),
            output: [formattedOutput],
          },
        ]);
      }
    }
  }, [executionStatus]);

  useEffect(() => {
    if (isOpen) {
      setChatMessages([]);
    }
  }, [isOpen]);

  const { inputs, handleInputChange } = useMultipleInputs(entryInputs);

  const sendMultiMessage = () => {
    const message = entryInputs
      .map((edge) => {
        const sourceHandle = edge.sourceHandle?.split(".")[1];
        return sourceHandle
          ? `${sourceHandle}: ${inputs[sourceHandle] ?? ""}`
          : "";
      })
      .join("\n");

    setChatMessages([{ input: [message], output: [""] }]);

    if (useApi) {
      void submitToAPI(message);
    } else {
      startWorkflowExecution({ inputs: [inputs] });
    }
  };

  const submitToAPI = async (message: string) => {
    if (!workflowId) {
      return;
    }
    const optimizationResponse = await optimization.mutateAsync({
      workflowId,
      inputMessages: [inputs],
      projectId: project?.id ?? "",
    });

    if (optimizationResponse.status === "success") {
      const formattedOutput = Object.entries(optimizationResponse.result)
        .map(([key, value]: [any, any]) => `${key}: ${value}`)
        .join("\n");

      setChatMessages([{ input: [message], output: [formattedOutput] }]);
    }
  };

  return (
    <HStack align={"start"} spacing={1} height={"100%"}>
      <MultipleInput
        inputs={inputs}
        handleInputChange={handleInputChange}
        sendMultiMessage={sendMultiMessage}
        isSingle={false}
        entryInputs={entryInputs}
      />
      <VStack
        spacing={4}
        align="stretch"
        width="100%"
        height={"100%"}
        border={"1px"}
        borderColor={"gray.200"}
        borderRadius={"lg"}
        padding={2}
      >
        <Box flexGrow={1} overflowY="auto">
          {chatMessages.map((message, index) => (
            <Flex key={index} flexDirection="column" width="100%" mb={4}>
              {message.input.map((input, inputIndex) => (
                <Box
                  key={`input-${inputIndex}`}
                  alignSelf="flex-end"
                  maxWidth="70%"
                  mb={2}
                >
                  <Text
                    bg="blue.500"
                    color="white"
                    p={2}
                    borderRadius="lg"
                    whiteSpace="pre-wrap"
                  >
                    {input}
                  </Text>
                </Box>
              ))}
              {message.output.map((output, outputIndex) =>
                output ||
                optimization.isLoading ||
                executionStatus === "running" ? (
                  <Box
                    key={`output-${outputIndex}`}
                    alignSelf="flex-start"
                    maxWidth="70%"
                    mb={2}
                  >
                    <Box
                      bg="gray.200"
                      p={2}
                      borderRadius="lg"
                      whiteSpace="pre-wrap"
                    >
                      {optimization.isLoading ||
                      executionStatus === "running" ? (
                        <RunningStatus isLoading={optimization.isLoading} />
                      ) : (
                        output
                      )}
                    </Box>
                  </Box>
                ) : null
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
};

const MultipleInput = ({
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
}) => {
  const { handleSubmit } = useForm();
  const onSubmit = () => {
    sendMultiMessage();
  };

  if (
    (!isSingle && entryInputs.length === 1) ||
    (isSingle && entryInputs.length > 1)
  ) {
    return;
  }
  if (entryInputs && entryInputs.length === 1) {
    return (
      <InputGroup
        as="form"
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        onSubmit={handleSubmit(onSubmit)}
      >
        <Input
          required
          value={inputs[0]}
          onChange={(e) =>
            handleInputChange(
              entryInputs[0]?.sourceHandle?.split(".")?.[1] ?? "",
              e.target.value
            )
          }
          placeholder={`Send ${entryInputs[0]?.sourceHandle?.split(".")[1]} `}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onSubmit();
              setTimeout(() => {
                (e.target as HTMLInputElement).value = "";
              }, 1);
            }
          }}
        />
        <InputRightElement padding={2}>
          <Button size="sm" padding={2} colorScheme="orange" type="submit">
            <Send />
          </Button>
        </InputRightElement>
      </InputGroup>
    );
  } else {
    return (
      <VStack
        width={"xl"}
        border={"1px"}
        borderColor={"gray.200"}
        borderRadius={"lg"}
        height={"100%"}
        padding={2}
        justifyContent="space-between"
        as="form"
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        onSubmit={handleSubmit(onSubmit)}
      >
        <Stack spacing={3} width={"full"}>
          {entryInputs.map((edge, index) => {
            return (
              <Stack key={index}>
                <SmallLabel>
                  {edge.sourceHandle?.split(".")[1] ?? `Input ${index + 1}`}
                </SmallLabel>
                <Input
                  key={index}
                  value={inputs[index]}
                  required
                  onChange={(e) =>
                    handleInputChange(
                      edge.sourceHandle?.split(".")[1] ?? "",
                      e.target.value
                    )
                  }
                />
              </Stack>
            );
          })}
        </Stack>
        <Button width="full" type="submit" colorScheme="orange">
          Submit
        </Button>
      </VStack>
    );
  }
};
