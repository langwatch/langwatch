import {
  Box,
  HStack,
  Input,
  Spacer,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";
import { BasePropertiesPanel, PropertyField } from "./BasePropertiesPanel";
import { LLMConfigField } from "./modals/LLMConfigModal";
import { WorkflowIcon } from "../ColorfulBlockIcons";
import { EmojiPickerModal } from "./modals/EmojiPickerModal";
import { useState } from "react";
import { useUpdateNodeInternals } from "@xyflow/react";
import { evaluatorInputs } from "./EndPropertiesPanel";
import type { End } from "../../types/dsl";
import { Switch } from "../../../components/ui/switch";
import { NativeSelect } from "@chakra-ui/react";
import { useDisclosure } from "@chakra-ui/react";

export const WorkflowPropertiesPanel = () => {
  const { getWorkflow, setWorkflow, setNode } = useWorkflowStore(
    ({ getWorkflow, setWorkflow, setNode }) => ({
      getWorkflow,
      setWorkflow,
      setNode,
    })
  );

  const workflow = getWorkflow();
  const [isEditingName, setIsEditingName] = useState(false);
  const [name, setName] = useState<string | undefined>(undefined);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [description, setDescription] = useState<string | undefined>(undefined);

  const { open, onClose, onToggle } = useDisclosure();

  const updateNodeInternals = useUpdateNodeInternals();

  const endNode = workflow.nodes.find((n) => n.type === "end");

  const [isEvaluator, setIsEvaluator] = useState(
    () => endNode?.data.behave_as === "evaluator"
  );

  const setAsEvaluator = () => {
    if (!endNode) return;

    if (!isEvaluator) {
      setNode({
        id: endNode.id,
        data: {
          ...endNode.data,
          inputs: evaluatorInputs,
          behave_as: "evaluator",
        } as End,
      });
      updateNodeInternals(endNode.id);
      setIsEvaluator(true);
    } else {
      setNode({
        id: endNode.id,
        data: {
          ...endNode.data,
          inputs: [{ type: "str", identifier: "output" }],
          behave_as: undefined,
        } as End,
      });

      updateNodeInternals(endNode.id);
      setIsEvaluator(false);
    }
  };

  return (
    <BasePropertiesPanel
      node={workflow}
      header={
        <>
          <HStack align="center" gap={2}>
            <VStack align="flex-start">
              <HStack align="center">
                <EmojiPickerModal
                  open={open}
                  onClose={onClose}
                  onChange={(emoji) => {
                    setWorkflow({ icon: emoji });
                  }}
                />
                <Box
                  role="button"
                  cursor="pointer"
                  onClick={onToggle}
                  paddingTop={1}
                >
                  <WorkflowIcon icon={workflow.icon} size="lg" />
                </Box>

                {isEditingName ? (
                  <Input
                    fontSize="15px"
                    marginLeft={1}
                    fontWeight={500}
                    variant="outline"
                    background="transparent"
                    value={name ?? workflow.name}
                    borderRadius={5}
                    paddingLeft={1}
                    margin={0}
                    size="sm"
                    onBlur={() => {
                      setIsEditingName(false);
                      if (name) {
                        setWorkflow({ name });
                      }
                    }}
                    onChange={(e) => {
                      setName(e.target.value);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        setIsEditingName(false);
                        if (name) {
                          setWorkflow({ name });
                        }
                      }
                    }}
                  />
                ) : (
                  <Text
                    fontSize="16px"
                    fontWeight={500}
                    onClick={() => {
                      setIsEditingName(true);
                      setIsEditingDescription(false);
                    }}
                  >
                    {workflow.name}
                  </Text>
                )}
              </HStack>

              {isEditingDescription ? (
                <Textarea
                  fontSize="12px"
                  marginLeft={1}
                  fontWeight={300}
                  variant="outline"
                  background="transparent"
                  value={description ?? workflow.description}
                  borderRadius={5}
                  paddingLeft={1}
                  margin={0}
                  width="300px"
                  size="sm"
                  onBlur={() => {
                    setIsEditingDescription(false);
                    if (description) {
                      setWorkflow({ description });
                    }
                  }}
                  onChange={(e) => {
                    setDescription(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setIsEditingDescription(false);
                      if (description) {
                        setWorkflow({ description });
                      }
                    }
                  }}
                />
              ) : (
                <Text
                  fontSize="12px"
                  fontWeight={400}
                  onClick={() => {
                    setIsEditingDescription(true);
                    setIsEditingName(false);
                  }}
                >
                  {workflow.description}
                </Text>
              )}
            </VStack>
          </HStack>
        </>
      }
    >
      <PropertyField
        title="Workflow Type"
        tooltip="Select Evaluator if you want to publish this workflow as an evaluator to be used for other workflows and on monitoring messages, this will change the End node for expected properties of an evaluator."
      >
        <NativeSelect.Root size="sm">
          <NativeSelect.Field
            value={isEvaluator ? "evaluator" : "workflow"}
            onChange={() => setAsEvaluator()}
          >
            <option value="workflow">Workflow</option>
            <option value="evaluator">Evaluator</option>
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </PropertyField>
      <PropertyField title="Default LLM">
        <LLMConfigField
          llmConfig={workflow.default_llm}
          onChange={(llmConfig) => {
            setWorkflow({ default_llm: llmConfig });
          }}
        />
      </PropertyField>
      <PropertyField title="Enable Tracing">
        <HStack paddingX={2} width="full">
          <Text fontSize="14px">
            Store execution traces when running this workflow
          </Text>
          <Spacer />
          <Switch
            checked={workflow.enable_tracing}
            onCheckedChange={() => {
              setWorkflow({ enable_tracing: !workflow.enable_tracing });
            }}
          />
        </HStack>
      </PropertyField>
    </BasePropertiesPanel>
  );
};
