import {
  Box,
  Button,
  createListCollection,
  HStack,
  IconButton,
  Input,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Select } from "~/components/ui/select";
import { getFieldSuggestions } from "~/features/traces-v2/components/SearchBar/suggestionItems";
import { getValueSuggestions } from "~/features/traces-v2/components/SearchBar/suggestionItems";
import {
  type Condition,
  type ConditionOperator,
  defaultOperatorForField,
  operatorsForValueType,
  queryToConditions,
  serializeConditions,
  valueTypeOfField,
} from "../logic/conditionQuery";

const OPERATOR_LABEL: Record<ConditionOperator, string> = {
  is: "is",
  is_not: "is not",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  between: "between",
};

/** The non-prefix fields, in the same order and labelling the traces
 *  autocomplete uses, so the builder's field list reads identically. */
const FIELD_OPTIONS = getFieldSuggestions("")
  .filter((s) => !s.isPrefix)
  .map((s) => ({ value: s.field, label: s.label }));

const FIELD_COLLECTION = createListCollection({ items: FIELD_OPTIONS });

/**
 * The structured, no-code front-end over the trace query language. Rows are
 * `field · operator · value`, joined by AND — the common case people reach for.
 * It reads and writes the SAME query string the Code editor shows (via
 * `conditionQuery`), so the two are always in sync and switching between them
 * never loses anything the builder can represent.
 *
 * Anything the builder can't represent (OR, grouping, free-text) keeps the
 * user in Code mode upstream; this component is only mounted for a structurable
 * query, and defends the invariant by ignoring an unparseable incoming value.
 */
export function ConditionBuilder({
  query,
  onChange,
}: {
  query: string;
  onChange: (query: string) => void;
}) {
  const [conditions, setConditions] = useState<Condition[]>(
    () => queryToConditions(query) ?? [],
  );
  // The last string we emitted, so the parent echoing it straight back doesn't
  // re-parse (and clobber the ids / in-progress blank rows) on every keystroke.
  const lastEmitted = useRef<string | null>(null);
  // Monotonic id source for rows the user adds (parsed rows are keyed c0, c1…).
  const nextId = useRef(0);

  useEffect(() => {
    if (query === lastEmitted.current) return;
    const parsed = queryToConditions(query);
    // A non-structurable value shouldn't reach us; if it does, don't wipe the
    // user's rows — leave them be and let Code mode own that query.
    if (parsed) setConditions(parsed);
  }, [query]);

  const commit = (next: Condition[]) => {
    setConditions(next);
    const q = serializeConditions(next);
    lastEmitted.current = q;
    onChange(q);
  };

  const update = (id: string, patch: Partial<Condition>) =>
    commit(conditions.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const setField = (id: string, field: string) =>
    commit(
      conditions.map((c) =>
        c.id === id
          ? {
              ...c,
              field,
              // The comparator and value only make sense for the new field's
              // type, so reset both when the field changes.
              operator: defaultOperatorForField(field),
              value: "",
              valueTo: "",
            }
          : c,
      ),
    );

  const addCondition = () =>
    commit([
      ...conditions,
      { id: `n${nextId.current++}`, field: "", operator: "is", value: "" },
    ]);

  const removeCondition = (id: string) =>
    commit(conditions.filter((c) => c.id !== id));

  return (
    <VStack align="stretch" gap={2}>
      {conditions.map((condition, index) => (
        <VStack key={condition.id} align="stretch" gap={2}>
          {index > 0 ? (
            <HStack gap={2} align="center">
              <Text
                textStyle="2xs"
                fontWeight="bold"
                letterSpacing="0.08em"
                color="fg.muted"
              >
                AND
              </Text>
              <Box flex={1} height="1px" bg="border.subtle" />
            </HStack>
          ) : null}
          <ConditionRow
            condition={condition}
            onField={(field) => setField(condition.id, field)}
            onOperator={(operator) => update(condition.id, { operator })}
            onValue={(value) => update(condition.id, { value })}
            onValueTo={(valueTo) => update(condition.id, { valueTo })}
            onRemove={() => removeCondition(condition.id)}
          />
        </VStack>
      ))}
      <Button
        alignSelf="flex-start"
        size="xs"
        variant="outline"
        onClick={addCondition}
      >
        <Plus size={13} />
        {conditions.length === 0 ? "Add a condition" : "Add AND condition"}
      </Button>
    </VStack>
  );
}

function ConditionRow({
  condition,
  onField,
  onOperator,
  onValue,
  onValueTo,
  onRemove,
}: {
  condition: Condition;
  onField: (field: string) => void;
  onOperator: (operator: ConditionOperator) => void;
  onValue: (value: string) => void;
  onValueTo: (valueTo: string) => void;
  onRemove: () => void;
}) {
  const valueType = valueTypeOfField(condition.field);
  const operators = operatorsForValueType(valueType);
  const operatorCollection = useMemo(
    () =>
      createListCollection({
        items: operators.map((op) => ({ value: op, label: OPERATOR_LABEL[op] })),
      }),
    [operators],
  );

  return (
    <HStack gap={2} align="center">
      <Box width="190px" flexShrink={0}>
        <Select.Root
          size="sm"
          collection={FIELD_COLLECTION}
          value={condition.field ? [condition.field] : []}
          onValueChange={({ value }) => value[0] && onField(value[0])}
        >
          <Select.Trigger>
            <Select.ValueText placeholder="Field…" />
          </Select.Trigger>
          <Select.Content>
            {FIELD_OPTIONS.map((item) => (
              <Select.Item key={item.value} item={item}>
                <Text>{item.label}</Text>
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </Box>

      {condition.field ? (
        <Box width="100px" flexShrink={0}>
          <Select.Root
            size="sm"
            collection={operatorCollection}
            value={[condition.operator]}
            onValueChange={({ value }) =>
              value[0] && onOperator(value[0] as ConditionOperator)
            }
          >
            <Select.Trigger>
              <Select.ValueText />
            </Select.Trigger>
            <Select.Content>
              {operatorCollection.items.map((item) => (
                <Select.Item key={item.value} item={item}>
                  <Text>{item.label}</Text>
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Box>
      ) : null}

      {condition.field ? (
        <Box flex={1} minWidth={0}>
          <ValueControl
            condition={condition}
            valueType={valueType}
            onValue={onValue}
            onValueTo={onValueTo}
          />
        </Box>
      ) : null}

      <IconButton
        aria-label="Remove condition"
        size="sm"
        variant="ghost"
        color="fg.muted"
        onClick={onRemove}
      >
        <X size={15} />
      </IconButton>
    </HStack>
  );
}

function ValueControl({
  condition,
  valueType,
  onValue,
  onValueTo,
}: {
  condition: Condition;
  valueType: ReturnType<typeof valueTypeOfField>;
  onValue: (value: string) => void;
  onValueTo: (valueTo: string) => void;
}) {
  if (condition.operator === "between") {
    return (
      <HStack gap={2} align="center">
        <Input
          size="sm"
          type="number"
          placeholder="min"
          value={condition.value}
          onChange={(e) => onValue(e.target.value)}
        />
        <Text textStyle="xs" color="fg.muted">
          and
        </Text>
        <Input
          size="sm"
          type="number"
          placeholder="max"
          value={condition.valueTo ?? ""}
          onChange={(e) => onValueTo(e.target.value)}
        />
      </HStack>
    );
  }

  if (valueType === "range") {
    return (
      <Input
        size="sm"
        type="number"
        placeholder="value"
        value={condition.value}
        onChange={(e) => onValue(e.target.value)}
      />
    );
  }

  // Categorical / existence fields with a known value set get a picker; open
  // fields (model, user, custom attributes) get free text.
  const suggestions =
    valueType === "categorical" || valueType === "existence"
      ? getValueSuggestions(condition.field, "")
      : [];

  if (suggestions.length > 0) {
    return (
      <ValuePicker
        value={condition.value}
        suggestions={suggestions}
        onValue={onValue}
      />
    );
  }

  return (
    <Input
      size="sm"
      placeholder="value"
      value={condition.value}
      onChange={(e) => onValue(e.target.value)}
    />
  );
}

function ValuePicker({
  value,
  suggestions,
  onValue,
}: {
  value: string;
  suggestions: string[];
  onValue: (value: string) => void;
}) {
  const collection = useMemo(
    () =>
      createListCollection({
        items: suggestions.map((v) => ({ value: v, label: v })),
      }),
    [suggestions],
  );
  return (
    <Select.Root
      size="sm"
      collection={collection}
      value={value ? [value] : []}
      onValueChange={({ value: next }) => next[0] && onValue(next[0])}
    >
      <Select.Trigger>
        <Select.ValueText placeholder="value…" />
      </Select.Trigger>
      <Select.Content>
        {collection.items.map((item) => (
          <Select.Item key={item.value} item={item}>
            <Text>{item.label}</Text>
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}
