import { Box, Button, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { useRef, useState } from "react";
import { TagPill } from "~/components/ui/TagPill";

type LLMJudgeVariableEditorProps = {
  /** Fixed variables from the evaluator definition (e.g. input, output, contexts). */
  fixedFields: string[];
  /** User-declared custom variables stored in settings.custom_variables. */
  customVariables: string[];
  /** Called when the user adds a new custom variable. */
  onAddVariable: (name: string) => void;
  /** Called when the user removes a custom variable. Fixed fields cannot be removed. */
  onRemoveCustomVariable: (name: string) => void;
  /** Called when a chip is clicked — parent appends {{name}} to the prompt. */
  onChipClick: (name: string) => void;
};

/**
 * Shows handlebars chips for all declared variables on a custom LLM judge,
 * and lets the author add custom input variables.
 *
 * Concept: making the variable contract explicit prevents the "fixed template"
 * feeling — authors can see what's available and declare new inputs without
 * needing to know the internal field names.
 */
export function LLMJudgeVariableEditor({
  fixedFields,
  customVariables,
  onAddVariable,
  onRemoveCustomVariable,
  onChipClick,
}: LLMJudgeVariableEditorProps) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const allDeclared = new Set([...fixedFields, ...customVariables]);

  const handleConfirm = () => {
    const name = draft.trim();
    if (!name) {
      setError("Variable name cannot be empty");
      return;
    }
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      setError("Only letters, digits, and underscores — must start with a letter");
      return;
    }
    if (allDeclared.has(name)) {
      setError(`"${name}" is already declared`);
      return;
    }
    onAddVariable(name);
    setDraft("");
    setError(null);
    setAdding(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleConfirm();
    }
    if (e.key === "Escape") {
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      setAdding(false);
      setDraft("");
      setError(null);
    }
  };

  return (
    <VStack align="stretch" gap={1}>
      <Text fontSize="xs" color="fg.muted" fontWeight="medium">
        Input variables — click to insert into prompt
      </Text>
      <HStack gap={2} flexWrap="wrap">
        {fixedFields.map((field) => (
          <Box
            key={field}
            as="button"
            type="button"
            onClick={() => onChipClick(field)}
            cursor="pointer"
            data-testid={`variable-chip-${field}`}
          >
            <TagPill label={`{{${field}}}`} />
          </Box>
        ))}
        {customVariables.map((field) => (
          <Box
            key={field}
            as="button"
            type="button"
            onClick={() => onChipClick(field)}
            cursor="pointer"
            data-testid={`variable-chip-${field}`}
          >
            <TagPill
              label={`{{${field}}}`}
              onRemove={() => onRemoveCustomVariable(field)}
            />
          </Box>
        ))}
        {adding ? (
          <HStack gap={1}>
            <Input
              ref={inputRef}
              size="xs"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setError(null);
              }}
              onKeyDown={handleKeyDown}
              placeholder="variable_name"
              autoFocus
              width="140px"
              data-testid="add-variable-input"
            />
            <Button
              size="xs"
              colorPalette="blue"
              onClick={handleConfirm}
              data-testid="add-variable-confirm"
            >
              Add
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                setAdding(false);
                setDraft("");
                setError(null);
              }}
            >
              Cancel
            </Button>
          </HStack>
        ) : (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              setAdding(true);
              setTimeout(() => inputRef.current?.focus(), 0);
            }}
            data-testid="add-variable-button"
          >
            <Plus size={12} />
            Add input variable
          </Button>
        )}
      </HStack>
      {error && (
        <Text fontSize="xs" color="fg.error" data-testid="add-variable-error">
          {error}
        </Text>
      )}
    </VStack>
  );
}
