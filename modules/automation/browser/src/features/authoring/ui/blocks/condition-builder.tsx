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
import { Select } from "@langwatch/design-system/select";
import {
  DYNAMIC_PREFIXES,
  FIELD_NAMES,
  FIELD_VALUES,
  SEARCH_FIELDS,
} from "@langwatch/trace-contract";
import { Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  type Condition,
  type ConditionOperator,
  type ConditionValueType,
  defaultOperatorForField,
  isConditionComplete,
  operatorsForValueType,
  queryToConditions,
  serializeConditions,
  valueTypeOfField,
} from "../../model/condition-query.ts";

const OPERATOR_LABEL: Record<ConditionOperator, string> = {
  is: "is",
  is_not: "is not",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  between: "between",
};

/** One selectable field: a plain field (`status`) or a custom-attribute prefix
 *  (`trace.attribute.<key>`), which opens a key sub-input on its row. */
interface FieldOption {
  value: string;
  label: string;
  isPrefix: boolean;
}

/** Every field the traces autocomplete offers, in its order and labelling, the
 *  custom-attribute prefixes included so a custom attribute is expressible here too. */
const FIELD_OPTIONS: FieldOption[] = [
  ...FIELD_NAMES.map((name) => ({
    value: name,
    label: SEARCH_FIELDS[name]?.label ?? name,
    isPrefix: false,
  })),
  ...DYNAMIC_PREFIXES.map((p) => ({ value: p.prefix, label: `${p.prefix}<key>`, isPrefix: true })),
];

/** Value mode keeps a top-N because facet enumerations run to hundreds. */
const MAX_VALUE_SUGGESTIONS = 10;

const FIELD_COLLECTION = createListCollection({ items: FIELD_OPTIONS });

/** The prefix options a row's field belongs to: one, or none for a plain field.
 *  Matches a bare prefix (no key typed yet) and a prefix with a key appended. */
export function matchAttributePrefix(field: string): FieldOption[] {
  return FIELD_OPTIONS.filter((opt) => opt.isPrefix && field.startsWith(opt.value)).slice(0, 1);
}

/** A prefix with no key typed yet (`"trace.attribute."`) has nothing to compare
 *  against, so it stays out of the emitted query until a key is entered. */
export function isPrefixOnly(field: string): boolean {
  return FIELD_OPTIONS.some((opt) => opt.isPrefix && opt.value === field);
}

/** Shown inline when `attributeFieldRoundTrips` rejects a custom-attribute key. */
export const ATTRIBUTE_KEY_ERROR =
  "This key can't be saved as written: remove any spaces or punctuation such as colons, quotes, or brackets.";

/**
 * True unless a completed custom-attribute row's key would change what the saved filter
 * means: the key is the one place raw keystrokes reach `field`, which serialises unescaped.
 * Checked by round-tripping the row's own serialised form through the query parser.
 */
export function attributeFieldRoundTrips(condition: Condition): boolean {
  if (matchAttributePrefix(condition.field).length === 0) return true;
  if (!isConditionComplete(condition)) return true;
  const reparsed = queryToConditions(serializeConditions([condition])) ?? [];
  const [only] = reparsed;
  if (reparsed.length !== 1 || !only) return false;
  return (
    only.field === condition.field &&
    only.operator === condition.operator &&
    only.value === condition.value &&
    (only.valueTo ?? "") === (condition.valueTo ?? "")
  );
}

/** The one gate for a row entering the emitted query: not a bare prefix pick, and
 *  its key round-trips through the query language. */
export function isUsableCondition(condition: Condition): boolean {
  return !isPrefixOnly(condition.field) && attributeFieldRoundTrips(condition);
}

let blankRowCounter = 0;
function blankCondition(): Condition {
  return { id: `blank${blankRowCounter++}`, field: "", operator: "is", value: "" };
}

/** A builder with zero rows reads as broken, so it seeds one blank editable row. It
 *  serialises to nothing, so save-gating on an untouched draft is unaffected. */
function withMinimumRow(conditions: Condition[]): Condition[] {
  return conditions.length > 0 ? conditions : [blankCondition()];
}

/**
 * Condition builder: field · operator · value rows, AND-joined. Synced with Code editor query.
 */
export function ConditionBuilder({
  query,
  onChange,
  onInvalidRowsChange,
}: {
  query: string;
  onChange: (query: string) => void;
  /** A completed row whose key cannot round-trip is left out of the query, so Save
   *  must hold until it is fixed; reset to false on unmount (Code mode owns raw text). */
  onInvalidRowsChange?: (hasInvalidRows: boolean) => void;
}) {
  const [conditions, setConditions] = useState<Condition[]>(() =>
    withMinimumRow(queryToConditions(query) ?? []),
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
    if (parsed) setConditions(withMinimumRow(parsed));
  }, [query]);

  const hasInvalidRow = conditions.some((condition) => !attributeFieldRoundTrips(condition));
  useEffect(() => {
    onInvalidRowsChange?.(hasInvalidRow);
    return () => onInvalidRowsChange?.(false);
  }, [hasInvalidRow, onInvalidRowsChange]);

  const commit = (next: Condition[]) => {
    setConditions(next);
    // A bare prefix pick and a key that would change the clause's meaning stay out of
    // the saved query, like any half-filled row; the row says why inline.
    const q = serializeConditions(next.filter(isUsableCondition));
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
    commit([...conditions, { id: `n${nextId.current++}`, field: "", operator: "is", value: "" }]);

  const removeCondition = (id: string) => commit(conditions.filter((c) => c.id !== id));

  return (
    <VStack align="stretch" gap={2}>
      {conditions.map((condition, index) => (
        <VStack key={condition.id} align="stretch" gap={2}>
          {index > 0 ? <AndSeparator /> : null}
          <ConditionRow
            condition={condition}
            onField={(field) => setField(condition.id, field)}
            onFieldKey={(field) => update(condition.id, { field })}
            onOperator={(operator) => update(condition.id, { operator })}
            onValue={(value) => update(condition.id, { value })}
            onValueTo={(valueTo) => update(condition.id, { valueTo })}
            onRemove={() => removeCondition(condition.id)}
          />
        </VStack>
      ))}
      <Button alignSelf="flex-start" size="xs" variant="outline" onClick={addCondition}>
        <Plus size={13} />
        {conditions.length === 0 ? "Add a condition" : "Add AND condition"}
      </Button>
    </VStack>
  );
}

/** The rule between rows: every condition must hold. */
function AndSeparator() {
  return (
    <HStack gap={2} align="center">
      <Text textStyle="2xs" fontWeight="bold" letterSpacing="0.08em" color="fg.muted">
        AND
      </Text>
      <Box flex={1} height="1px" bg="border.subtle" />
    </HStack>
  );
}

function ConditionRow({
  condition,
  onField,
  onFieldKey,
  onOperator,
  onValue,
  onValueTo,
  onRemove,
}: {
  condition: Condition;
  onField: (field: string) => void;
  /** Updates only the key of a custom-attribute field; not a field switch. */
  onFieldKey: (field: string) => void;
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
        items: operators.map((op) => ({
          value: op,
          label: OPERATOR_LABEL[op],
        })),
      }),
    [operators],
  );

  const [attributePrefix] = matchAttributePrefix(condition.field);
  const attributeKey = attributePrefix ? condition.field.slice(attributePrefix.value.length) : "";
  // Only meaningful once the row is otherwise complete: an unfinished key is not wrong.
  const isAttributeKeyInvalid = !attributeFieldRoundTrips(condition);
  const attributeKeyErrorId = `condition-${condition.id}-key-error`;

  return (
    <VStack align="stretch" gap={1}>
      <HStack gap={2} align="center" flexWrap="wrap" rowGap={2}>
        <FieldSelect
          value={attributePrefix ? attributePrefix.value : condition.field}
          onField={onField}
        />

        {attributePrefix ? (
          <Box width="130px" flexShrink={0}>
            <Input
              size="sm"
              placeholder="attribute key"
              aria-label={`${attributePrefix.label} key`}
              value={attributeKey}
              aria-invalid={isAttributeKeyInvalid}
              aria-describedby={isAttributeKeyInvalid ? attributeKeyErrorId : undefined}
              borderColor={isAttributeKeyInvalid ? "border.error" : undefined}
              onChange={(e) => onFieldKey(attributePrefix.value + e.target.value)}
            />
          </Box>
        ) : null}

        {condition.field ? (
          <Box width="100px" flexShrink={0}>
            <Select.Root
              size="sm"
              collection={operatorCollection}
              value={[condition.operator]}
              onValueChange={({ value }) => {
                const next = operators.find((op) => op === value[0]);
                if (next) onOperator(next);
              }}
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
      {isAttributeKeyInvalid ? (
        <Text id={attributeKeyErrorId} textStyle="2xs" color="fg.error">
          {ATTRIBUTE_KEY_ERROR}
        </Text>
      ) : null}
    </VStack>
  );
}

/** The field picker at the head of a row. For custom-attribute fields the
 *  selected value is the prefix; the key is edited in its own input. */
function FieldSelect({ value, onField }: { value: string; onField: (field: string) => void }) {
  return (
    <Box width="190px" flexShrink={0}>
      <Select.Root
        size="sm"
        collection={FIELD_COLLECTION}
        value={value ? [value] : []}
        onValueChange={({ value: next }) => next[0] && onField(next[0])}
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
  );
}

function ValueControl({
  condition,
  valueType,
  onValue,
  onValueTo,
}: {
  condition: Condition;
  valueType: ConditionValueType | undefined;
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
      ? (FIELD_VALUES[condition.field] ?? []).slice(0, MAX_VALUE_SUGGESTIONS)
      : [];

  if (suggestions.length > 0) {
    return <ValuePicker value={condition.value} suggestions={suggestions} onValue={onValue} />;
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
