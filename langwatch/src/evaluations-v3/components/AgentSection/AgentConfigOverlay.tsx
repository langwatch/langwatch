import {
  Box,
  Button,
  Field,
  HStack,
  Input,
  NativeSelect,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useState } from "react";

import { useEvaluationsV3Store } from "../../hooks/useEvaluationsV3Store";
import type { AgentConfig, AgentType, FieldMapping } from "../../types";
import { ConfigPanel } from "../ConfigPanel";

/**
 * Configuration panel for an agent (LLM or code executor).
 *
 * Features:
 * - Type selection (LLM or code)
 * - LLM configuration (model, instructions, prompt)
 * - Code configuration (code editor)
 * - Input/output field configuration
 * - Input mapping to dataset columns
 */
export function AgentConfigPanel() {
  const {
    ui,
    closeOverlay,
    agents,
    dataset,
    addAgent,
    updateAgent,
    setAgentMapping,
  } = useEvaluationsV3Store((state) => ({
    ui: state.ui,
    closeOverlay: state.closeOverlay,
    agents: state.agents,
    dataset: state.dataset,
    addAgent: state.addAgent,
    updateAgent: state.updateAgent,
    setAgentMapping: state.setAgentMapping,
  }));

  const isOpen = ui.openOverlay === "agent";
  const targetId = ui.overlayTargetId;
  const existingAgent = targetId
    ? agents.find((a) => a.id === targetId)
    : undefined;

  // Local form state
  const [agentType, setAgentType] = useState<AgentType>("llm");
  const [name, setName] = useState("");
  const [model, setModel] = useState("openai/gpt-4o");
  const [instructions, setInstructions] = useState("");
  const [promptTemplate, setPromptTemplate] = useState("{{input}}");
  const [code, setCode] = useState("");
  const [inputMapping, setInputMapping] = useState<Record<string, string>>({});

  // Initialize form when opening for existing agent
  useEffect(() => {
    if (isOpen && existingAgent) {
      setAgentType(existingAgent.type);
      setName(existingAgent.name);
      setModel(existingAgent.llmConfig?.model ?? "openai/gpt-4o");
      setInstructions(existingAgent.instructions ?? "");
      setPromptTemplate(
        existingAgent.messages?.[0]?.content?.toString() ?? "{{input}}"
      );
      setCode(existingAgent.code ?? "");

      // Load existing mappings from agent.mappings
      const mappings = existingAgent.mappings ?? {};
      const mappingState: Record<string, string> = {};
      for (const [inputField, mapping] of Object.entries(mappings)) {
        mappingState[inputField] = mapping.sourceField;
      }
      setInputMapping(mappingState);
    } else if (isOpen && !existingAgent) {
      // Reset for new agent
      setAgentType("llm");
      setName("");
      setModel("openai/gpt-4o");
      setInstructions("");
      setPromptTemplate("{{input}}");
      setCode("");
      setInputMapping({});
    }
  }, [isOpen, existingAgent]);

  // Extract input variables from prompt template
  const extractInputsFromPrompt = useCallback((template: string): string[] => {
    const matches = template.match(/\{\{(\w+)\}\}/g) ?? [];
    return [...new Set(matches.map((m) => m.replace(/\{\{|\}\}/g, "")))];
  }, []);

  const detectedInputs =
    agentType === "llm" ? extractInputsFromPrompt(promptTemplate) : ["input"];

  const handleSave = useCallback(() => {
    const agentConfig: AgentConfig = {
      id: existingAgent?.id ?? `agent-${nanoid(8)}`,
      type: agentType,
      name: name || `${agentType === "llm" ? "LLM" : "Code"} Agent`,
      inputs: detectedInputs.map((id) => ({ identifier: id, type: "str" })),
      outputs: [{ identifier: "output", type: "str" }],
      mappings: existingAgent?.mappings ?? {}, // Preserve existing mappings
      evaluatorIds: existingAgent?.evaluatorIds ?? [], // Preserve existing evaluator references
      ...(agentType === "llm"
        ? {
            llmConfig: { model },
            instructions,
            messages: [{ role: "user", content: promptTemplate }],
          }
        : {
            code,
          }),
    };

    if (existingAgent) {
      updateAgent(existingAgent.id, agentConfig);
    } else {
      addAgent(agentConfig);
    }

    // Save input mappings (updates agent.mappings via setAgentMapping)
    for (const inputField of detectedInputs) {
      const sourceField = inputMapping[inputField];
      if (sourceField) {
        setAgentMapping(agentConfig.id, inputField, {
          source: "dataset",
          sourceField,
        });
      }
    }

    closeOverlay();
  }, [
    existingAgent,
    agentType,
    name,
    model,
    instructions,
    promptTemplate,
    code,
    detectedInputs,
    inputMapping,
    addAgent,
    updateAgent,
    setAgentMapping,
    closeOverlay,
  ]);

  return (
    <ConfigPanel
      isOpen={isOpen}
      onClose={closeOverlay}
      title={existingAgent ? "Edit Agent" : "Add Agent"}
      width="420px"
    >
      <VStack gap={4} align="stretch">
        {/* Agent Type Selection */}
        <Field.Root>
          <Field.Label>Agent Type</Field.Label>
          <NativeSelect.Root>
            <NativeSelect.Field
              value={agentType}
              onChange={(e) => setAgentType(e.target.value as AgentType)}
            >
              <option value="llm">LLM Prompt</option>
              <option value="code">Code Executor</option>
            </NativeSelect.Field>
          </NativeSelect.Root>
        </Field.Root>

        {/* Name */}
        <Field.Root>
          <Field.Label>Name</Field.Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={agentType === "llm" ? "My LLM Agent" : "My Code Agent"}
          />
        </Field.Root>

        {/* LLM Configuration */}
        {agentType === "llm" && (
          <>
            <Field.Root>
              <Field.Label>Model</Field.Label>
              <NativeSelect.Root>
                <NativeSelect.Field
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                >
                  <option value="openai/gpt-4o">OpenAI GPT-4o</option>
                  <option value="openai/gpt-4o-mini">OpenAI GPT-4o Mini</option>
                  <option value="openai/gpt-3.5-turbo">
                    OpenAI GPT-3.5 Turbo
                  </option>
                  <option value="anthropic/claude-3-5-sonnet-20241022">
                    Claude 3.5 Sonnet
                  </option>
                  <option value="anthropic/claude-3-opus-20240229">
                    Claude 3 Opus
                  </option>
                </NativeSelect.Field>
              </NativeSelect.Root>
            </Field.Root>

            <Field.Root>
              <Field.Label>System Instructions (optional)</Field.Label>
              <Textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="You are a helpful assistant..."
                rows={3}
              />
            </Field.Root>

            <Field.Root>
              <Field.Label>Prompt Template</Field.Label>
              <Textarea
                value={promptTemplate}
                onChange={(e) => setPromptTemplate(e.target.value)}
                placeholder="Answer this question: {{input}}"
                rows={4}
                fontFamily="mono"
                fontSize="sm"
              />
              <Field.HelperText>
                Use {"{{variable}}"} syntax for inputs. Detected:{" "}
                {detectedInputs.join(", ") || "none"}
              </Field.HelperText>
            </Field.Root>
          </>
        )}

        {/* Code Configuration */}
        {agentType === "code" && (
          <Field.Root>
            <Field.Label>Code</Field.Label>
            <Textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={'def execute(input):\n    return {"output": input}'}
              rows={10}
              fontFamily="mono"
              fontSize="sm"
            />
            <Field.HelperText>
              Python code that receives inputs and returns outputs
            </Field.HelperText>
          </Field.Root>
        )}

        {/* Input Mappings */}
        <Box>
          <Text fontWeight="medium" fontSize="sm" marginBottom={2}>
            Input Mappings
          </Text>
          <VStack gap={2} align="stretch">
            {detectedInputs.map((inputField) => (
              <HStack key={inputField}>
                <Text fontSize="sm" minWidth="80px" color="gray.600">
                  {inputField} =
                </Text>
                <NativeSelect.Root flex={1}>
                  <NativeSelect.Field
                    value={inputMapping[inputField] ?? ""}
                    onChange={(e) =>
                      setInputMapping((prev) => ({
                        ...prev,
                        [inputField]: e.target.value,
                      }))
                    }
                  >
                    <option value="">Select column...</option>
                    <optgroup label="Dataset Columns">
                      {dataset.columns.map((col) => (
                        <option key={col.id} value={col.name}>
                          {col.name}
                        </option>
                      ))}
                    </optgroup>
                  </NativeSelect.Field>
                </NativeSelect.Root>
              </HStack>
            ))}
            {detectedInputs.length === 0 && (
              <Text fontSize="sm" color="gray.500" fontStyle="italic">
                No inputs detected. Add {"{{variable}}"} to your prompt.
              </Text>
            )}
          </VStack>
        </Box>

        {/* Actions */}
        <HStack gap={2} paddingTop={4}>
          <Button variant="ghost" onClick={closeOverlay} flex={1}>
            Cancel
          </Button>
          <Button colorPalette="blue" onClick={handleSave} flex={1}>
            {existingAgent ? "Save Changes" : "Add Agent"}
          </Button>
        </HStack>
      </VStack>
    </ConfigPanel>
  );
}
