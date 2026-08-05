import { Button, chakra, HStack, Input, Stack, Text } from "@chakra-ui/react";
import { BadgeCheck, Gauge, type LucideIcon, Tag, X } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { toaster } from "../../../../../components/ui/toaster";
import type { EvaluatorOption } from "../../../hooks/useEvaluatorOptions";
import {
  EVAL_COLUMN_FIELDS,
  EVAL_FIELD_LABELS,
  type EvalColumnField,
  formatEvalColumnId,
} from "../../../lens/evalColumnId";
import { evalColumnLabel } from "../../TraceTable/evalColumns";

/** Toast hint shown after a column is added, shared with the picker's own
 *  column-toggle toast so the copy stays in one place. */
export const COLUMN_APPENDED_HINT =
  "Appears at the end. Use the arrows under “Visible order” to reposition.";

const EVAL_FIELD_ICONS: Record<EvalColumnField, LucideIcon> = {
  score: Gauge,
  verdict: BadgeCheck,
  label: Tag,
};

/** Top 5 evaluators matching the trimmed query (by label or id). */
const useEvaluatorSuggestions = ({
  evaluatorOptions,
  trimmed,
}: {
  evaluatorOptions: EvaluatorOption[];
  trimmed: string;
}) =>
  useMemo(() => {
    const q = trimmed.toLowerCase();
    const matches = q
      ? evaluatorOptions.filter(
          (o) =>
            o.label.toLowerCase().includes(q) ||
            o.value.toLowerCase().includes(q),
        )
      : evaluatorOptions;
    return matches.slice(0, 5);
  }, [evaluatorOptions, trimmed]);

/** Free-text evaluator search box; Enter commits, Escape bubbles to close. */
const EvaluatorSearchInput: React.FC<{
  query: string;
  onChange: (value: string) => void;
  onCommit: (value: string) => void;
}> = ({ query, onChange, onCommit }) => (
  <Input
    size="xs"
    placeholder="Evaluator name or id…"
    value={query}
    onChange={(e) => onChange(e.target.value)}
    onKeyDown={(e) => {
      if (e.key === "Escape") return;
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        onCommit(query);
      }
    }}
  />
);

/** Field selector row (Score / Verdict / Label). */
const FieldPicker: React.FC<{
  field: EvalColumnField;
  onSelect: (field: EvalColumnField) => void;
}> = ({ field, onSelect }) => (
  <HStack gap={1}>
    {EVAL_COLUMN_FIELDS.map((f) => {
      const FieldIcon = EVAL_FIELD_ICONS[f];
      const isActive = field === f;
      return (
        <Button
          key={f}
          size="xs"
          flex={1}
          gap={1}
          variant={isActive ? "solid" : "outline"}
          colorPalette={isActive ? "blue" : "gray"}
          onClick={() => onSelect(f)}
        >
          <FieldIcon size={12} />
          {EVAL_FIELD_LABELS[f]}
        </Button>
      );
    })}
  </HStack>
);

/** Discovered-evaluator list: already-shown rows offer Remove, the rest add. */
const EvaluatorSuggestions: React.FC<{
  suggestions: EvaluatorOption[];
  field: EvalColumnField;
  columnOrder: string[];
  onAdd: (key: string) => void;
  onToggle: (id: string) => void;
}> = ({ suggestions, field, columnOrder, onAdd, onToggle }) => (
  <Stack gap={0}>
    {suggestions.map((o) => {
      const id = formatEvalColumnId({ field, evaluatorKey: o.value });
      const isAdded = columnOrder.includes(id);
      return isAdded ? (
        <HStack
          key={o.value}
          gap={1}
          paddingX={1.5}
          paddingY={1}
          borderRadius="sm"
          _hover={{ bg: "bg.muted" }}
        >
          <Text flex={1} textStyle="xs" color="fg.subtle" truncate>
            {o.label}
          </Text>
          <chakra.button
            type="button"
            onClick={() => onToggle(id)}
            aria-label={`Remove ${o.label} column`}
            display="inline-flex"
            alignItems="center"
            gap={0.5}
            cursor="pointer"
            color="fg.subtle"
            _hover={{ color: "red.fg" }}
          >
            <X size={11} />
            <Text textStyle="2xs" fontWeight="medium">
              Remove
            </Text>
          </chakra.button>
        </HStack>
      ) : (
        <Button
          key={o.value}
          size="xs"
          variant="ghost"
          width="100%"
          justifyContent="flex-start"
          fontWeight="normal"
          paddingX={1.5}
          onClick={() => onAdd(o.value)}
        >
          <Text textStyle="xs" color="fg" truncate>
            {o.label}
          </Text>
        </Button>
      );
    })}
  </Stack>
);

/**
 * Builds the commit handler that appends an `eval:<field>:<key>` column. If the
 * typed text matches a discovered evaluator (by id or label), the column is
 * keyed by its id — same as the suggestion-click path — so it binds to stored
 * eval results consistently. Otherwise the text is treated as a literal
 * free-text key. Re-adding an already-shown column surfaces an info toast.
 */
const useEvalColumnAdder = ({
  evaluatorOptions,
  nameByKey,
  columnOrder,
  field,
  onToggle,
  onCommitted,
}: {
  evaluatorOptions: EvaluatorOption[];
  nameByKey: Map<string, string>;
  columnOrder: string[];
  field: EvalColumnField;
  onToggle: (id: string) => void;
  onCommitted: () => void;
}) => {
  return (rawKey: string) => {
    const trimmedKey = rawKey.trim();
    if (!trimmedKey) return;
    const match = evaluatorOptions.find(
      (o) =>
        o.value === trimmedKey ||
        o.label.toLowerCase() === trimmedKey.toLowerCase(),
    );
    const key = match ? match.value : trimmedKey;
    const id = formatEvalColumnId({ field, evaluatorKey: key });
    if (columnOrder.includes(id)) {
      toaster.create({
        title: "That eval column is already shown",
        type: "info",
        duration: 2500,
      });
      return;
    }
    onToggle(id);
    toaster.create({
      title: `Added "${evalColumnLabel({
        field,
        evaluatorKey: key,
        evaluatorNames: nameByKey,
      })}"`,
      description: COLUMN_APPENDED_HINT,
      type: "info",
      duration: 3500,
    });
    onCommitted();
  };
};

type AddEvalColumnFormProps = {
  evaluatorOptions: EvaluatorOption[];
  nameByKey: Map<string, string>;
  columnOrder: string[];
  onToggle: (id: string) => void;
};

/**
 * The "Add custom column" control in the picker's Evaluations section. Pick
 * a field (Score / Verdict / Label) and an evaluator (discovered list or
 * free-text); each commit appends an `eval:<field>:<key>` column. An
 * already-shown evaluator offers an inline Remove instead of re-adding.
 */
export const AddEvalColumnForm: React.FC<AddEvalColumnFormProps> = ({
  evaluatorOptions,
  nameByKey,
  columnOrder,
  onToggle,
}) => {
  const [query, setQuery] = useState("");
  const [field, setField] = useState<EvalColumnField>("score");
  const trimmed = query.trim();

  const suggestions = useEvaluatorSuggestions({ evaluatorOptions, trimmed });

  const add = useEvalColumnAdder({
    evaluatorOptions,
    nameByKey,
    columnOrder,
    field,
    onToggle,
    onCommitted: () => setQuery(""),
  });

  return (
    <Stack gap={1.5}>
      <Text textStyle="2xs" color="fg.subtle">
        Show one evaluator's result as a column
      </Text>
      <FieldPicker field={field} onSelect={setField} />
      <EvaluatorSearchInput query={query} onChange={setQuery} onCommit={add} />
      {suggestions.length > 0 && (
        <EvaluatorSuggestions
          suggestions={suggestions}
          field={field}
          columnOrder={columnOrder}
          onAdd={add}
          onToggle={onToggle}
        />
      )}
      {trimmed.length > 0 && (
        <Button
          size="xs"
          variant="outline"
          width="100%"
          onClick={() => add(trimmed)}
        >
          Add “{trimmed}” column
        </Button>
      )}
    </Stack>
  );
};
