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
import {
  getFieldSuggestions,
  getValueSuggestions,
} from "~/features/traces-v2/components/SearchBar/suggestionItems";
import {
  type Condition,
  type ConditionOperator,
  defaultOperatorForField,
  isConditionComplete,
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

/** One selectable field: a plain field (`status`, `cost`) or a custom-
 *  attribute prefix (`trace.attribute.<key>`, `span.attribute.<key>`,
 *  `event.attribute.<key>`). Picking a prefix opens a key sub-input
 *  (`ConditionRow`) so the row can target one specific attribute. */
interface FieldOption {
  value: string;
  label: string;
  isPrefix: boolean;
}

/** Every field the traces autocomplete offers, in the same order and
 *  labelling it uses, so the builder's field list reads identically —
 *  including the custom-attribute prefixes, so a condition on a custom
 *  attribute is expressible here too, not just in Code mode. */
const FIELD_OPTIONS: FieldOption[] = getFieldSuggestions("").map((s) => ({
  value: s.field,
  label: s.label,
  isPrefix: s.isPrefix ?? false,
}));

const FIELD_COLLECTION = createListCollection({ items: FIELD_OPTIONS });

/** The prefix option a row's field belongs to, or `null` for a plain field
 *  (or no field yet). Matches both a bare prefix (just picked, no key typed
 *  yet) and a prefix with a key already appended — the two states
 *  `ConditionRow` needs to tell apart to render the key sub-input. */
export function matchAttributePrefix(field: string): FieldOption | null {
  return (
    FIELD_OPTIONS.find((opt) => opt.isPrefix && field.startsWith(opt.value)) ??
    null
  );
}

/** A prefix with no key typed yet (`"trace.attribute."`) can't serialise to
 *  a valid query clause — there's nothing to compare against — so it's
 *  excluded from the query the builder emits until a key is entered. */
export function isPrefixOnly(field: string): boolean {
  return FIELD_OPTIONS.some((opt) => opt.isPrefix && opt.value === field);
}

/** Customer-facing constraint for a custom-attribute key, shown inline when
 *  `attributeFieldRoundTrips` rejects one. Names the constraint rather than
 *  the mechanism — the author doesn't need to know it's a query-language
 *  restriction, only what to change. */
export const ATTRIBUTE_KEY_ERROR =
  "This key can't be saved as written — remove any spaces, colons, or quotes.";

/**
 * True unless `condition` is a completed custom-attribute row whose key
 * would change what the saved filter means. Every other field comes from
 * the fixed `FIELD_OPTIONS` dropdown and is always safe; the attribute key
 * is the only place a user's raw keystrokes flow straight into `field`, and
 * `serializeCondition` inserts `field` into the query unescaped (only the
 * value goes through `escapeValue`). A key containing whitespace or liqe
 * syntax — a space, `:`, a quote, a bracket — can silently retarget the
 * clause (`trace.attribute.foo bar` parses as two unrelated clauses,
 * `trace.attribute. ` fails to parse at all) instead of failing loudly.
 *
 * Verified by round-tripping the row's own serialised form back through the
 * same parser the query editor and dispatcher use: if it doesn't come back
 * as the exact one clause it was built from, the key isn't safe to save.
 */
export function attributeFieldRoundTrips(condition: Condition): boolean {
  if (!matchAttributePrefix(condition.field)) return true;
  if (!isConditionComplete(condition)) return true; // nothing to check yet
  const serialized = serializeConditions([condition]);
  if (!serialized) return true; // unreachable given isConditionComplete above
  const reparsed = queryToConditions(serialized);
  if (reparsed?.length !== 1) return false;
  const [only] = reparsed;
  if (!only) return false;
  return (
    only.field === condition.field &&
    only.operator === condition.operator &&
    only.value === condition.value &&
    (only.valueTo ?? "") === (condition.valueTo ?? "")
  );
}

let blankRowCounter = 0;
function blankCondition(): Condition {
  return {
    id: `blank${blankRowCounter++}`,
    field: "",
    operator: "is",
    value: "",
  };
}

/** A brand-new builder with zero rows reads as broken — nothing to fill in
 *  but a small "Add a condition" button, right where an "Add at least one
 *  condition." warning sits below it. Seeding one blank, editable row makes
 *  the surface read as ready-to-fill instead. It still doesn't serialise to
 *  anything (an empty field skips `isConditionComplete`), so save-gating on
 *  an untouched draft is unaffected. */
function withMinimumRow(conditions: Condition[]): Condition[] {
  return conditions.length > 0 ? conditions : [blankCondition()];
}

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

  const commit = (next: Condition[]) => {
    setConditions(next);
    // A prefix the author picked but hasn't typed a key into yet has nothing
    // to compare against, and a key that would change what the clause means
    // (whitespace, `:`, a quote) must never reach the saved query — both are
    // excluded the same way any other half-filled row is, with the reason
    // shown inline on the row (see `attributeFieldRoundTrips`).
    const usable = next.filter(
      (c) => !isPrefixOnly(c.field) && attributeFieldRoundTrips(c),
    );
    const q = serializeConditions(usable);
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

/** The rule between rows: every condition must hold. */
function AndSeparator() {
  return (
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
  /** Updates just the key portion of a custom-attribute field
   *  (`trace.attribute.<key>`), leaving the operator and value alone —
   *  unlike `onField`, this isn't a field switch. */
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

  const attributePrefix = matchAttributePrefix(condition.field);
  const attributeKey = attributePrefix
    ? condition.field.slice(attributePrefix.value.length)
    : "";
  // Only meaningful once the row is otherwise complete — a key the author
  // hasn't finished typing yet isn't wrong, just unfinished.
  const attributeKeyInvalid = !attributeFieldRoundTrips(condition);

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
              aria-invalid={attributeKeyInvalid}
              borderColor={attributeKeyInvalid ? "border.error" : undefined}
              onChange={(e) =>
                onFieldKey(attributePrefix.value + e.target.value)
              }
            />
          </Box>
        ) : null}

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
      {attributeKeyInvalid ? (
        <Text textStyle="2xs" color="fg.error">
          {ATTRIBUTE_KEY_ERROR}
        </Text>
      ) : null}
    </VStack>
  );
}

/** The field picker at the head of a row. For custom-attribute fields the
 *  selected value is the prefix; the key is edited in its own input. */
function FieldSelect({
  value,
  onField,
}: {
  value: string;
  onField: (field: string) => void;
}) {
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
