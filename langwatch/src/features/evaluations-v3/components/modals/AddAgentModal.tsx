/**
 * Add Agent Modal
 *
 * Modal for adding or editing an agent (LLM or Code).
 */

import {
  Box,
  Button,
  createListCollection,
  Field,
  HStack,
  Input,
  Tabs,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { LuBrain, LuCode, LuPlus, LuTrash2 } from "react-icons/lu";
import { Dialog } from "../../../../components/ui/dialog";
import { Select } from "../../../../components/ui/select";
import { useEvaluationV3Store } from "../../store/useEvaluationV3Store";
import { useShallow } from "zustand/react/shallow";
import type { Agent, LLMAgent, CodeAgent } from "../../types";
import { nanoid } from "nanoid";
import type { Field as DSLField } from "../../../../optimization_studio/types/dsl";
import { DEFAULT_MAX_TOKENS } from "../../../../optimization_studio/utils/registryUtils";

// Common models
const MODELS = [
  { label: "GPT-5", value: "openai/gpt-5" },
  { label: "GPT-4o", value: "openai/gpt-4o" },
  { label: "GPT-4o-mini", value: "openai/gpt-4o-mini" },
  { label: "Claude Opus 4", value: "anthropic/claude-opus-4-20250514" },
  { label: "Claude Sonnet 4", value: "anthropic/claude-sonnet-4-20250514" },
  { label: "Claude 3.5 Sonnet", value: "anthropic/claude-3-5-sonnet-20241022" },
  { label: "Gemini 2.0 Flash", value: "google/gemini-2.0-flash-001" },
  { label: "Gemini 1.5 Pro", value: "google/gemini-1.5-pro" },
];

const modelsCollection = createListCollection({ items: MODELS });

type Props = {
  agentId?: string;
  onClose: () => void;
};

export function AddAgentModal({ agentId, onClose }: Props) {
  const { agents, dataset, addAgent, updateAgent, removeAgent, autoMapAgent } =
    useEvaluationV3Store(
      useShallow((s) => ({
        agents: s.agents,
        dataset: s.dataset,
        addAgent: s.addAgent,
        updateAgent: s.updateAgent,
        removeAgent: s.removeAgent,
        autoMapAgent: s.autoMapAgent,
      }))
    );

  const existingAgent = agentId ? agents.find((a) => a.id === agentId) : null;
  const isEditing = !!existingAgent;

  const [agentType, setAgentType] = useState<"llm" | "code">(
    existingAgent?.type ?? "llm"
  );
  const [name, setName] = useState(existingAgent?.name ?? "");
  const [model, setModel] = useState(
    existingAgent?.type === "llm" ? existingAgent.model : "openai/gpt-5"
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

  const handleSave = () => {
    const id = existingAgent?.id ?? `agent_${nanoid(8)}`;

    if (agentType === "llm") {
      const llmAgent: LLMAgent = {
        id,
        type: "llm",
        name: name || "LLM Agent",
        model,
        llmConfig: {
          model,
          temperature: 1,
          max_tokens: DEFAULT_MAX_TOKENS,
        },
        messages: [
          {
            role: "user",
            content: promptContent,
          },
        ],
        inputs,
        outputs,
      };

      if (isEditing) {
        updateAgent(id, llmAgent);
      } else {
        addAgent(llmAgent);
        // Auto-map after adding
        setTimeout(() => autoMapAgent(id), 0);
      }
    } else {
      const codeAgent: CodeAgent = {
        id,
        type: "code",
        name: name || "Code Agent",
        code,
        inputs,
        outputs,
      };

      if (isEditing) {
        updateAgent(id, codeAgent);
      } else {
        addAgent(codeAgent);
        setTimeout(() => autoMapAgent(id), 0);
      }
    }

    onClose();
  };

  const handleDelete = () => {
    if (agentId && confirm("Are you sure you want to delete this agent?")) {
      removeAgent(agentId);
      onClose();
    }
  };

  const addInput = () => {
    const existingIds = inputs.map((i) => i.identifier);
    let newId = "input";
    let counter = 2;
    while (existingIds.includes(newId)) {
      newId = `input_${counter}`;
      counter++;
    }
    setInputs([...inputs, { identifier: newId, type: "str" }]);
  };

  const addOutput = () => {
    const existingIds = outputs.map((o) => o.identifier);
    let newId = "output";
    let counter = 2;
    while (existingIds.includes(newId)) {
      newId = `output_${counter}`;
      counter++;
    }
    setOutputs([...outputs, { identifier: newId, type: "str" }]);
  };

  return (
    <Dialog.Root open={true} onOpenChange={({ open }) => !open && onClose()}>
      <Dialog.Backdrop />
      <Dialog.Content maxWidth="600px">
        <Dialog.Header>
          <Dialog.Title>
            {isEditing ? "Edit Agent" : "Add Agent"}
          </Dialog.Title>
          <Dialog.CloseTrigger />
        </Dialog.Header>

        <Dialog.Body>
          <VStack gap={4} align="stretch">
            {/* Agent Type Tabs */}
            {!isEditing && (
              <Tabs.Root
                value={agentType}
                onValueChange={(e) => setAgentType(e.value as "llm" | "code")}
                colorPalette="purple"
              >
                <Tabs.List>
                  <Tabs.Trigger value="llm">
                    <LuBrain size={16} />
                    LLM Prompt
                  </Tabs.Trigger>
                  <Tabs.Trigger value="code">
                    <LuCode size={16} />
                    Code
                  </Tabs.Trigger>
                </Tabs.List>
              </Tabs.Root>
            )}

            {/* Name */}
            <Field.Root>
              <Field.Label>Name</Field.Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Agent name"
              />
            </Field.Root>

            {/* LLM Config */}
            {agentType === "llm" && (
              <>
                <Field.Root>
                  <Field.Label>Model</Field.Label>
                  <Select.Root
                    collection={modelsCollection}
                    value={[model]}
                    onValueChange={(e) => setModel(e.value[0] ?? "openai/gpt-5")}
                  >
                    <Select.Trigger>
                      <Select.ValueText placeholder="Select model" />
                    </Select.Trigger>
                    <Select.Content>
                      {MODELS.map((m) => (
                        <Select.Item key={m.value} item={m}>
                          {m.label}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                </Field.Root>

                <Field.Root>
                  <Field.Label>Prompt</Field.Label>
                  <Field.HelperText>
                    Use {"{{variable}}"} syntax to reference dataset columns
                  </Field.HelperText>
                  <Textarea
                    value={promptContent}
                    onChange={(e) => setPromptContent(e.target.value)}
                    placeholder="Enter your prompt here. Use {{input}} to reference the input column."
                    minHeight="150px"
                    fontFamily="mono"
                    fontSize="sm"
                  />
                </Field.Root>
              </>
            )}

            {/* Code Config */}
            {agentType === "code" && (
              <Field.Root>
                <Field.Label>Python Code</Field.Label>
                <Field.HelperText>
                  Define a forward function that takes inputs and returns outputs
                </Field.HelperText>
                <Textarea
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder={getDefaultCode()}
                  minHeight="200px"
                  fontFamily="mono"
                  fontSize="sm"
                />
              </Field.Root>
            )}

            {/* Inputs */}
            <Field.Root>
              <Field.Label>Inputs</Field.Label>
              <VStack gap={2} align="stretch">
                {inputs.map((input, idx) => (
                  <HStack key={idx} gap={2}>
                    <Input
                      value={input.identifier}
                      onChange={(e) => {
                        const newInputs = [...inputs];
                        newInputs[idx] = { ...input, identifier: e.target.value };
                        setInputs(newInputs);
                      }}
                      placeholder="input_name"
                      size="sm"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      colorPalette="red"
                      onClick={() => setInputs(inputs.filter((_, i) => i !== idx))}
                      disabled={inputs.length <= 1}
                    >
                      <LuTrash2 size={14} />
                    </Button>
                  </HStack>
                ))}
                <Button variant="outline" size="sm" onClick={addInput}>
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
                  <HStack key={idx} gap={2}>
                    <Input
                      value={output.identifier}
                      onChange={(e) => {
                        const newOutputs = [...outputs];
                        newOutputs[idx] = { ...output, identifier: e.target.value };
                        setOutputs(newOutputs);
                      }}
                      placeholder="output_name"
                      size="sm"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      colorPalette="red"
                      onClick={() => setOutputs(outputs.filter((_, i) => i !== idx))}
                      disabled={outputs.length <= 1}
                    >
                      <LuTrash2 size={14} />
                    </Button>
                  </HStack>
                ))}
                <Button variant="outline" size="sm" onClick={addOutput}>
                  <LuPlus size={14} />
                  Add Output
                </Button>
              </VStack>
            </Field.Root>
          </VStack>
        </Dialog.Body>

        <Dialog.Footer>
          <HStack gap={2} width="full">
            {isEditing && (
              <Button
                variant="ghost"
                colorPalette="red"
                onClick={handleDelete}
              >
                <LuTrash2 size={14} />
                Delete
              </Button>
            )}
            <Box flex={1} />
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button colorPalette="purple" onClick={handleSave}>
              {isEditing ? "Save Changes" : "Add Agent"}
            </Button>
          </HStack>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

const getDefaultCode = () => `import dspy

class CustomModule(dspy.Module):
    def forward(self, input: str) -> str:
        # Your code here
        return {"output": input}
`;

