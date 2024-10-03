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
  VStack,
} from "@chakra-ui/react";
import { useCallback, useState, useEffect } from "react";
import { SmallLabel } from "~/components/SmallLabel";
import { Send } from "react-feather";
import { useWorkflowExecution } from "../hooks/useWorkflowExecution";
import { useWorkflowStore } from "../hooks/useWorkflowStore";
import { RunningStatus } from "./ExecutionState";
import { titleCase } from "../../utils/stringCasing";

import { type Edge } from "@xyflow/react";

interface ChatWindowProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ChatWindow = ({ isOpen, onClose }: ChatWindowProps) => {
  return (
    <Modal onClose={onClose} size={"5xl"} isOpen={isOpen}>
      <ModalOverlay />
      <ModalContent maxHeight={"100vh"}>
        <ModalHeader>Test Message</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <ChatBox />
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
    console.log("key-value", key, value);
    setInputs((prev) => ({ ...prev, [key]: value }));
  }, []);

  return { inputs, handleInputChange };
};

const ChatBox = () => {
  const { getWorkflow, executionStatus } = useWorkflowStore((state) => ({
    getWorkflow: state.getWorkflow,
    setWorkflowExecutionState: state.setWorkflowExecutionState,
    executionStatus: state.state.execution?.status,
  }));

  const { startWorkflowExecution } = useWorkflowExecution();

  const { nodes } = useWorkflowStore();
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  const workflow = getWorkflow();

  console.log(workflow);

  const entryEdges = workflow.edges.filter((edge) => edge.source === "entry");

  useEffect(() => {
    if (workflow.state.execution?.status === "success") {
      const result = workflow.state.execution?.result;

      if (result && typeof result === "object") {
        const firstKey = Object.keys(result)[0];

        if (firstKey && typeof result[firstKey] === "object") {
          const formattedOutput = Object.entries(result[firstKey]!)
            .map(([key, value]) => `${titleCase(key)}: ${String(value)}`)
            .join("\n");

          setChatMessages([
            {
              input: [chatMessages[0]?.input ?? ""].flat(),
              output: [formattedOutput],
            },
          ]);
        }
      }
    }
  }, [workflow.state.execution?.status]);

  const { inputs, handleInputChange } = useMultipleInputs(entryEdges);

  const sendMultiMessage = () => {
    const message = entryEdges
      .map((edge) => {
        const sourceHandle = edge.sourceHandle?.split(".")[1];
        return sourceHandle
          ? `${sourceHandle}: ${inputs[sourceHandle] ?? ""}`
          : "";
      })
      .join("\n");

    setChatMessages([{ input: [message], output: [""] }]);

    startWorkflowExecution({ inputs: [inputs] });
  };

  return (
    <HStack align={"start"} spacing={1}>
      <MultipleInput
        entryEdges={entryEdges}
        inputs={inputs}
        handleInputChange={handleInputChange}
        sendMultiMessage={sendMultiMessage}
        isSingle={false}
      />
      <VStack
        spacing={4}
        align="stretch"
        width="100%"
        height={"60vh"}
        border={"1px"}
        borderColor={"gray.200"}
        borderRadius={"lg"}
        padding={2}
      >
        <Box flexGrow={1} overflowY="auto" maxHeight="60vh">
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
                executionStatus === "running" || output ? (
                  <Box
                    key={`output-${outputIndex}`}
                    alignSelf="flex-start"
                    maxWidth="70%"
                    mb={2}
                  >
                    <Text
                      bg="gray.200"
                      p={2}
                      borderRadius="lg"
                      whiteSpace="pre-wrap"
                    >
                      {executionStatus === "running" ? (
                        <RunningStatus />
                      ) : (
                        output
                      )}
                    </Text>
                  </Box>
                ) : null
              )}
            </Flex>
          ))}
        </Box>

        <MultipleInput
          entryEdges={entryEdges}
          inputs={inputs}
          handleInputChange={handleInputChange}
          sendMultiMessage={sendMultiMessage}
          isSingle={true}
        />
      </VStack>
    </HStack>
  );
};

const MultipleInput = ({
  entryEdges,
  inputs,
  handleInputChange,
  sendMultiMessage,
  isSingle,
}: {
  entryEdges: Edge[];
  inputs: Record<string, string>;
  handleInputChange: (key: string, value: string) => void;
  sendMultiMessage: () => void;
  isSingle: boolean;
}) => {
  console.log(isSingle);
  if (
    (!isSingle && entryEdges.length === 1) ||
    (isSingle && entryEdges.length > 1)
  ) {
    return;
  }
  if (entryEdges && entryEdges.length === 1) {
    return (
      <InputGroup>
        <Input
          value={inputs[0]}
          onChange={(e) =>
            handleInputChange(
              entryEdges[0]?.sourceHandle?.split(".")?.[1] ?? "",
              e.target.value
            )
          }
          placeholder={`Send ${entryEdges[0]?.sourceHandle?.split(".")[1]} `}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              sendMultiMessage();
            }
          }}
        />
        <InputRightElement padding={2}>
          <Button
            size="sm"
            padding={2}
            colorScheme="orange"
            onClick={sendMultiMessage}
          >
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
        height={"60vh"}
        padding={2}
        justifyContent="space-between"
      >
        <Stack spacing={3} width={"full"}>
          {entryEdges.map((edge, index) => {
            return (
              <Stack key={index}>
                <SmallLabel>
                  {edge.sourceHandle?.split(".")[1] ?? `Input ${index + 1}`}
                </SmallLabel>
                <Input
                  key={index}
                  value={inputs[index]}
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
        <Button width="full" colorScheme="orange" onClick={sendMultiMessage}>
          Submit
        </Button>
      </VStack>
    );
  }
};
