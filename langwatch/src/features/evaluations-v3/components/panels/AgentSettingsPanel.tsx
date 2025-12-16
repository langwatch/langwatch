/**
 * Agent Settings Panel
 *
 * Side panel (drawer) for configuring agent settings and variable mapping.
 * Opens from the right side so users can see the spreadsheet while editing.
 */

import {
  Box,
  Button,
  Field,
  HStack,
  Input,
  NativeSelect,
  Separator,
  Tabs,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { useEffect, useState, useMemo } from "react";
import { LuBrain, LuCode, LuPlus, LuTrash2, LuX } from "react-icons/lu";
import { Drawer, DrawerFooter } from "../../../../components/ui/drawer";
import { useEvaluationV3Store } from "../../store/useEvaluationV3Store";
import { useShallow } from "zustand/react/shallow";
import type { Agent, LLMAgent, CodeAgent, MappingSource } from "../../types";
import { nanoid } from "nanoid";
import type { Field as DSLField } from "../../../../optimization_studio/types/dsl";
import { DEFAULT_MAX_TOKENS } from "../../../../optimization_studio/utils/registryUtils";

// Common models - these should come from a shared config
const MODELS = [
  { label: "GPT-4o", value: "openai/gpt-4o" },
  { label: "GPT-4o-mini", value: "openai/gpt-4o-mini" },
  { label: "Claude Opus 4", value: "anthropic/claude-opus-4-20250514" },
  { label: "Claude Sonnet 4", value: "anthropic/claude-sonnet-4-20250514" },
  { label: "Claude 3.5 Sonnet", value: "anthropic/claude-3-5-sonnet-20241022" },
  { label: "Gemini 2.0 Flash", value: "google/gemini-2.0-flash-001" },
  { label: "Gemini 1.5 Pro", value: "google/gemini-1.5-pro" },
];

type Props = {
  agentId?: string;
  isOpen: boolean;
  onClose: () => void;
};

export function AgentSettingsPanel({ agentId, isOpen, onClose }: Props) {
  const {
    agents,
    dataset,
    agentMappings,
    addAgent,
    updateAgent,
    removeAgent,
    autoMapAgent,
    setAgentInputMapping,
  } = useEvaluationV3Store(
    useShallow((s) => ({
      agents: s.agents,
      dataset: s.dataset,
      agentMappings: s.agentMappings,
      addAgent: s.addAgent,
      updateAgent: s.updateAgent,
      removeAgent: s.removeAgent,
      autoMapAgent: s.autoMapAgent,
      setAgentInputMapping: s.setAgentInputMapping,
    }))
  );

  const existingAgent = agentId ? agents.find((a) => a.id === agentId) : null;
  const isEditing = !!existingAgent;

  const [agentType, setAgentType] = useState<"llm" | "code">(
    existingAgent?.type ?? "llm"
  );
  const [name, setName] = useState(existingAgent?.name ?? "");
  const [model, setModel] = useState(
    existingAgent?.type === "llm" ? existingAgent.model : "openai/gpt-4o"
  );
  const [promptContent, setPromptContent] = useState(
    existingAgent?.type === "llm"
      ? existingAgent.messages?.[0]?.content ?? ""
      : ""
  );
  const [code, setCode] = useState(
    existingAgent?.type === "code" ? existingAgent.code : getDefaultCode()
  );
  const [inputs, setInputs] = useState<DSLField[]>(
    existingAgent?.inputs ?? [{ identifier: "input", type: "str" }]
  );
  const [outputs, setOutputs] = useState<DSLField[]>(
    existingAgent?.outputs ?? [{ identifier: "output", type: "str" }]
  );

  // Get current mappings for this agent
  const currentMapping = agentMappings.find((m) => m.agentId === agentId);

  // Auto-generate name if empty
  useEffect(() => {
    if (!name && !isEditing) {
      const modelName = MODELS.find((m) => m.value === model)?.label ?? "Agent";
      const existingNames = agents.map((a) => a.name);
      let newName = modelName;
      let counter = 2;
      while (existingNames.includes(newName)) {
        newName = `${modelName} ${counter}`;
        counter++;
      }
      setName(newName);
    }
  }, [model, agents, name, isEditing]);

  // Reset form when agent changes
  useEffect(() => {
    if (existingAgent) {
      setAgentType(existingAgent.type);
      setName(existingAgent.name);
      if (existingAgent.type === "llm") {
        setModel(existingAgent.model);
        setPromptContent(existingAgent.messages?.[0]?.content ?? "");
      } else {
        setCode(existingAgent.code);
      }
      setInputs(existingAgent.inputs);
      setOutputs(existingAgent.outputs);
    }
  }, [existingAgent]);

  const handleSave = () => {
    const newAgentId = agentId ?? nanoid();

    if (agentType === "llm") {
      const agentData: LLMAgent = {
        id: newAgentId,
        type: "llm",
        name: name || "Untitled Agent",
        model,
        llmConfig: {
          model,
          temperature: 0,
          max_tokens: DEFAULT_MAX_TOKENS,
        },
        messages: [{ role: "user", content: promptContent }],
        inputs,
        outputs,
      };

      if (isEditing && agentId) {
        updateAgent(agentId, agentData);
      } else {
        addAgent(agentData);
        autoMapAgent(newAgentId);
      }
    } else {
      const agentData: CodeAgent = {
        id: newAgentId,
        type: "code",
        name: name || "Code Agent",
        code,
        inputs,
        outputs,
      };

      if (isEditing && agentId) {
        updateAgent(agentId, agentData);
      } else {
        addAgent(agentData);
        autoMapAgent(newAgentId);
      }
    }

    onClose();
  };

  const handleDelete = () => {
    if (agentId) {
      removeAgent(agentId);
      onClose();
    }
  };

  const handleMappingChange = (inputId: string, value: string) => {
    if (!agentId) return;

    let source: MappingSource | null = null;
    if (value && value.startsWith("dataset:")) {
      source = { type: "dataset", columnId: value.replace("dataset:", "") };
    }

    setAgentInputMapping(agentId, inputId, source);
  };

  // Build mapping options from dataset columns
  const mappingOptions = useMemo(() => {
    const options: { value: string; label: string; group: string }[] = [];

    // Dataset columns
    for (const col of dataset.columns) {
      options.push({
        value: `dataset:${col.id}`,
        label: col.name,
        group: "Dataset Columns",
      });
    }

    return options;
  }, [dataset.columns]);

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={({ open }) => !open && onClose()}
      placement="end"
      size="md"
    >
      <Drawer.Backdrop />
      <Drawer.Content>
        <Drawer.Header borderBottomWidth="1px">
          <Drawer.Title>
            {isEditing ? "Edit Agent" : "Add Agent"}
          </Drawer.Title>
          <Drawer.CloseTrigger asChild>
            <Button variant="ghost" size="sm" position="absolute" right={4} top={4}>
              <LuX />
            </Button>
          </Drawer.CloseTrigger>
        </Drawer.Header>
        <Drawer.Body>
          <VStack gap={6} align="stretch">
            {/* Agent Type Tabs */}
            {!isEditing && (
              <Tabs.Root
                value={agentType}
                onValueChange={(e) => setAgentType(e.value as "llm" | "code")}
                colorPalette="purple"
              >
                <Tabs.List>
                  <Tabs.Trigger value="llm">
                    <LuBrain size={14} />
                    <Text marginLeft={2}>LLM Prompt</Text>
                  </Tabs.Trigger>
                  <Tabs.Trigger value="code">
                    <LuCode size={14} />
                    <Text marginLeft={2}>Code</Text>
                  </Tabs.Trigger>
                </Tabs.List>
              </Tabs.Root>
            )}

            {/* Name Field */}
            <Field.Root>
              <Field.Label>Name</Field.Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Agent name"
              />
            </Field.Root>

            {agentType === "llm" ? (
              <>
                {/* Model Selection */}
                <Field.Root>
                  <Field.Label>Model</Field.Label>
                  <NativeSelect.Root>
                    <NativeSelect.Field
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                    >
                      {MODELS.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </NativeSelect.Field>
                    <NativeSelect.Indicator />
                  </NativeSelect.Root>
                </Field.Root>

                {/* Prompt */}
                <Field.Root>
                  <Field.Label>Prompt</Field.Label>
                  <Field.HelperText>
                    Use {"{{variable}}"} syntax to reference dataset columns
                  </Field.HelperText>
                  <Textarea
                    value={promptContent}
                    onChange={(e) => setPromptContent(e.target.value)}
                    placeholder={`Enter your prompt here. Use {{input}} to reference the input column.`}
                    rows={8}
                    fontFamily="mono"
                    fontSize="sm"
                  />
                </Field.Root>
              </>
            ) : (
              /* Code Editor */
              <Field.Root>
                <Field.Label>Code</Field.Label>
                <Textarea
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  fontFamily="mono"
                  fontSize="sm"
                  rows={15}
                />
              </Field.Root>
            )}

            {/* Inputs */}
            <Field.Root>
              <Field.Label>Inputs</Field.Label>
              <VStack gap={2} align="stretch">
                {inputs.map((input, idx) => (
                  <HStack key={idx}>
                    <Input
                      value={input.identifier}
                      onChange={(e) => {
                        const newInputs = [...inputs];
                        newInputs[idx] = { ...input, identifier: e.target.value };
                        setInputs(newInputs);
                      }}
                      placeholder="input name"
                      size="sm"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setInputs(inputs.filter((_, i) => i !== idx))}
                      disabled={inputs.length <= 1}
                    >
                      <LuTrash2 size={14} />
                    </Button>
                  </HStack>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setInputs([...inputs, { identifier: "", type: "str" }])
                  }
                >
                  <LuPlus size={14} />
                  Add Input
                </Button>
              </VStack>
            </Field.Root>

            {/* Outputs */}
            <Field.Root>
              <Field.Label>Outputs</Field.Label>
              <VStack gap={2} align="stretch">
                {outputs.map((output, idx) => (
                  <HStack key={idx}>
                    <Input
                      value={output.identifier}
                      onChange={(e) => {
                        const newOutputs = [...outputs];
                        newOutputs[idx] = { ...output, identifier: e.target.value };
                        setOutputs(newOutputs);
                      }}
                      placeholder="output name"
                      size="sm"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setOutputs(outputs.filter((_, i) => i !== idx))}
                      disabled={outputs.length <= 1}
                    >
                      <LuTrash2 size={14} />
                    </Button>
                  </HStack>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setOutputs([...outputs, { identifier: "", type: "str" }])
                  }
                >
                  <LuPlus size={14} />
                  Add Output
                </Button>
              </VStack>
            </Field.Root>

            {/* Variable Mapping Section - Only show when editing */}
            {isEditing && inputs.length > 0 && (
              <>
                <Separator />
                <VStack gap={4} align="stretch">
                  <Text fontWeight="semibold" fontSize="sm">
                    Input Mapping
                  </Text>
                  <Text fontSize="sm" color="gray.600">
                    Connect agent inputs to dataset columns
                  </Text>

                  {inputs.map((input) => {
                    const currentValue = currentMapping?.inputMappings?.[input.identifier];
                    const selectValue = currentValue?.type === "dataset"
                      ? `dataset:${currentValue.columnId}`
                      : "";

                    return (
                      <HStack key={input.identifier} gap={3}>
                        <Box
                          paddingX={3}
                          paddingY={2}
                          background="purple.50"
                          borderRadius="md"
                          minWidth="120px"
                        >
                          <Text fontSize="sm" fontWeight="medium" color="purple.700">
                            {input.identifier}
                          </Text>
                        </Box>
                        <Text color="gray.500">=</Text>
                        <NativeSelect.Root flex={1}>
                          <NativeSelect.Field
                            value={selectValue}
                            onChange={(e) => handleMappingChange(input.identifier, e.target.value)}
                          >
                            <option value="">Select source...</option>
                            <optgroup label="Dataset Columns">
                              {dataset.columns.map((col) => (
                                <option key={col.id} value={`dataset:${col.id}`}>
                                  {col.name}
                                </option>
                              ))}
                            </optgroup>
                          </NativeSelect.Field>
                          <NativeSelect.Indicator />
                        </NativeSelect.Root>
                      </HStack>
                    );
                  })}
                </VStack>
              </>
            )}
          </VStack>
        </Drawer.Body>
        <DrawerFooter borderTopWidth="1px" gap={3}>
          {isEditing && (
            <Button variant="outline" colorPalette="red" onClick={handleDelete}>
              Delete Agent
            </Button>
          )}
          <Box flex={1} />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button colorPalette="purple" onClick={handleSave}>
            {isEditing ? "Save Changes" : "Add Agent"}
          </Button>
        </DrawerFooter>
      </Drawer.Content>
    </Drawer.Root>
  );
}

function getDefaultCode(): string {
  return `def execute(input: str) -> str:
    """
    Process the input and return the output.

    Args:
        input: The input text to process

    Returns:
        The processed output
    """
    # Your code here
    return input
`;
}

