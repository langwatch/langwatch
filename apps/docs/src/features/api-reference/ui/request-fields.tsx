import {
  Badge,
  Box,
  chakra,
  Flex,
  Input,
  NativeSelect,
  Text,
} from "@langwatch/design-system/primitives";

import type { ScalarField } from "../model/body-form.ts";
import { optionText } from "../model/field-value.ts";

/** A field's name, its type and whether the request needs it. */
export function FieldLabel({
  htmlFor,
  id,
  name,
  typeLabel,
  required,
  deprecated,
  as = "label",
}: {
  htmlFor?: string;
  id?: string;
  name: string;
  typeLabel: string;
  required: boolean;
  deprecated: boolean;
  as?: "label" | "legend" | "span";
}) {
  return (
    <chakra.label
      as={as}
      id={id}
      htmlFor={as === "label" ? htmlFor : undefined}
      display="flex"
      flexWrap="wrap"
      alignItems="center"
      columnGap="2"
      fontSize="13px"
      lineHeight="20px"
      fontWeight="600"
      marginBottom="1.5"
      padding="0"
    >
      <Box as="span" fontFamily="mono" overflowWrap="anywhere">
        {name}
      </Box>
      <Text as="span" fontWeight="400" color="fg.muted" fontSize="12px">
        {typeLabel}
        {required ? " · Required" : ""}
      </Text>
      {deprecated ? (
        <Badge size="sm" variant="subtle" colorPalette="yellow">
          Deprecated
        </Badge>
      ) : null}
    </chakra.label>
  );
}

/** The schema's description under its control, two lines at most, whole in its title. */
export function FieldHint({ id, text, utc }: { id: string; text: string; utc: boolean }) {
  const hint = [utc ? "In UTC." : "", text].filter(Boolean).join(" ");
  if (!hint) return null;
  return (
    <Text
      id={id}
      margin="0"
      marginTop="1"
      fontSize="12px"
      lineHeight="18px"
      color="fg.muted"
      lineClamp={2}
      title={text || undefined}
    >
      {hint}
    </Text>
  );
}

function omitLabel({ field }: { field: ScalarField }) {
  if (field.required) return "Select a value";
  if (field.defaultValue === void 0) return "Omit";
  return `Omit (default ${optionText({ option: field.defaultValue })})`;
}

const INPUTS: Partial<
  Record<
    ScalarField["kind"],
    { type: string; step?: number | "any"; inputMode?: "numeric" | "decimal" }
  >
> & { text: { type: string } } = {
  text: { type: "text" },
  date: { type: "date" },
  "date-time": { type: "datetime-local", step: 1 },
  "epoch-ms": { type: "datetime-local", step: 1 },
  integer: { type: "number", step: 1, inputMode: "numeric" },
  number: { type: "number", step: "any", inputMode: "decimal" },
};

/**
 * One typed control. `bodyKey` marks a body field for the island, which reads and fills the form by
 * it; a parameter is read by its id.
 */
export function ScalarControl({
  field,
  id,
  value,
  bodyKey,
  label,
  describedBy,
  onChange,
}: {
  field: ScalarField;
  id: string;
  value: string;
  bodyKey?: string;
  label?: string;
  describedBy?: string;
  onChange?: (value: string) => void;
}) {
  const common = {
    id,
    "data-body-field": bodyKey,
    "aria-label": label,
    "aria-describedby": describedBy,
    "aria-required": field.required || undefined,
  };
  const change = (event: { target: { value: string } }) => onChange?.(event.target.value);
  const bound = onChange ? { value, onChange: change } : { defaultValue: value };
  if (field.kind === "enum")
    return (
      <NativeSelect.Root size="sm">
        <NativeSelect.Field {...common} {...bound}>
          <option value="">{omitLabel({ field })}</option>
          {field.options.map((option) => (
            <option key={optionText({ option })} value={optionText({ option })}>
              {optionText({ option })}
            </option>
          ))}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
    );
  if (field.kind === "boolean")
    return field.required ? (
      <BooleanCheck common={common} checked={value === "true"} />
    ) : (
      <BooleanSwitch id={id} value={value} bodyKey={bodyKey} label={label} />
    );
  const input = INPUTS[field.kind] ?? INPUTS.text;
  return (
    <Input
      {...common}
      {...bound}
      size="sm"
      type={input.type}
      step={input.step}
      min={field.min}
      max={field.max}
      inputMode={input.inputMode}
      placeholder={input.type === "text" ? field.name : undefined}
      autoComplete="off"
      spellCheck={false}
    />
  );
}

function BooleanCheck({ common, checked }: { common: Record<string, unknown>; checked: boolean }) {
  return (
    <chakra.span display="flex" alignItems="center" gap="2" minHeight="36px" fontSize="13px">
      <chakra.input
        type="checkbox"
        {...common}
        defaultChecked={checked}
        width="18px"
        height="18px"
        margin="0"
        accentColor="var(--chakra-colors-docs-primary-fill, currentColor)"
      />
    </chakra.span>
  );
}

const SWITCH_OPTIONS = [
  { value: "", label: "Omit" },
  { value: "true", label: "true" },
  { value: "false", label: "false" },
];

/** Omit, true or false: an optional boolean has three answers, so a checkbox cannot hold it. */
function BooleanSwitch({
  id,
  value,
  bodyKey,
  label,
}: {
  id: string;
  value: string;
  bodyKey?: string;
  label?: string;
}) {
  return (
    <Flex
      id={id}
      role="radiogroup"
      aria-labelledby={label ? undefined : `${id}-label`}
      aria-label={label}
      className="docs-boolean-switch"
      display="inline-flex"
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
      overflow="hidden"
      width="fit-content"
    >
      {SWITCH_OPTIONS.map((option) => (
        <chakra.label
          key={option.value}
          position="relative"
          display="flex"
          alignItems="center"
          minHeight="36px"
          paddingX="3"
          fontSize="13px"
          fontWeight="500"
          fontFamily={option.value ? "mono" : undefined}
          cursor="pointer"
          color="fg.muted"
          borderLeftWidth={option.value ? "1px" : "0"}
          borderColor="border"
          _hover={{ color: "fg" }}
          css={{
            "&:has(input:checked)": {
              background: "var(--chakra-colors-bg-emphasized)",
              color: "var(--chakra-colors-fg)",
            },
            "&:has(input:focus-visible)": {
              outline: "2px solid var(--chakra-colors-accent-fg)",
              outlineOffset: "-2px",
            },
          }}
        >
          <chakra.input
            type="radio"
            name={id}
            value={option.value}
            data-body-field={bodyKey}
            defaultChecked={value === option.value}
            position="absolute"
            opacity="0"
            width="1px"
            height="1px"
          />
          {option.label}
        </chakra.label>
      ))}
    </Flex>
  );
}

/** Whether a field's label row can name its control with `for`. */
export function labelsByFor({ field }: { field: ScalarField }) {
  return !(field.kind === "boolean" && !field.required);
}
