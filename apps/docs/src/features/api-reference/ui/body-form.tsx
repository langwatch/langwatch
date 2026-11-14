import { Box, Button, chakra, Flex, IconButton } from "@langwatch/design-system/primitives";
import { Plus, X } from "lucide-react";

import type {
  FormField,
  GroupField,
  JsonField,
  ListField,
  ScalarField,
} from "../model/body-form.ts";
import { isScalar } from "../model/body-form.ts";
import type { FormEntries } from "../model/body-value.ts";
import { FieldHint, FieldLabel, labelsByFor, ScalarControl } from "./request-fields.tsx";

const idOf = ({ field }: { field: FormField }) => `pg-body-${field.key}`;
const FULL_ROW = { gridColumn: "1 / -1" } as const;

function utcOf({ field }: { field: ScalarField }) {
  return field.kind === "date-time" || field.kind === "epoch-ms";
}

function ScalarBodyField({ field, entries }: { field: ScalarField; entries: FormEntries }) {
  const id = idOf({ field });
  const hint = field.description || utcOf({ field }) ? `${id}-hint` : undefined;
  return (
    <Box className="docs-request-field" minWidth="0">
      <FieldLabel
        htmlFor={labelsByFor({ field }) ? id : undefined}
        id={`${id}-label`}
        as={labelsByFor({ field }) ? "label" : "span"}
        name={field.name}
        typeLabel={field.typeLabel}
        required={field.required}
        deprecated={field.deprecated}
      />
      <ScalarControl
        field={field}
        id={id}
        value={entries[field.key]?.[0] ?? ""}
        bodyKey={field.key}
        describedBy={hint}
      />
      {hint ? <FieldHint id={hint} text={field.description} utc={utcOf({ field })} /> : null}
    </Box>
  );
}

function ListRow({
  field,
  row,
  value,
  number,
}: {
  field: ListField;
  row: string;
  value: string;
  number: string;
}) {
  return (
    <Flex data-body-row="" gap="2" alignItems="center">
      <Box flex="1" minWidth="0">
        <ScalarControl
          field={field.item}
          id={`${idOf({ field })}-${row}`}
          value={value}
          bodyKey={field.key}
          label={`${field.name} item ${number}`}
        />
      </Box>
      <IconButton
        type="button"
        size="sm"
        variant="ghost"
        colorPalette="gray"
        data-body-remove=""
        aria-label={`Remove ${field.name} item ${number}`}
      >
        <X size={16} aria-hidden="true" />
      </IconButton>
    </Flex>
  );
}

/** Rows of plain values; the island clones the template for Add. */
function ListBodyField({ field, entries }: { field: ListField; entries: FormEntries }) {
  const id = idOf({ field });
  const rows = entries[field.key] ?? [];
  return (
    <chakra.fieldset
      id={id}
      data-body-list={field.key}
      data-body-name={field.name}
      aria-describedby={field.description ? `${id}-hint` : undefined}
      minWidth="0"
      margin="0"
      padding="0"
      border="0"
      {...FULL_ROW}
    >
      <FieldLabel
        as="legend"
        name={field.name}
        typeLabel={field.typeLabel}
        required={field.required}
        deprecated={field.deprecated}
      />
      <Flex direction="column" gap="2" data-body-rows="">
        {rows.map((value, index) => (
          <ListRow
            key={index}
            field={field}
            row={String(index)}
            value={value}
            number={String(index + 1)}
          />
        ))}
      </Flex>
      <template data-body-row-template="">
        <ListRow field={field} row="__row__" value="" number="__number__" />
      </template>
      <Button
        type="button"
        size="xs"
        variant="ghost"
        colorPalette="gray"
        marginTop={rows.length ? "2" : "0"}
        minHeight="32px"
        data-body-add=""
        aria-label={`Add ${field.name} item`}
      >
        <Plus size={14} aria-hidden="true" /> Add item
      </Button>
      <FieldHint id={`${id}-hint`} text={field.description} utc={false} />
    </chakra.fieldset>
  );
}

function JsonBodyField({ field, entries }: { field: JsonField; entries: FormEntries }) {
  const id = idOf({ field });
  const value = entries[field.key]?.[0] ?? "";
  return (
    <Box className="docs-request-field" minWidth="0" {...FULL_ROW}>
      <FieldLabel
        htmlFor={id}
        name={field.name}
        typeLabel={field.typeLabel === "JSON" ? "JSON" : `${field.typeLabel} · JSON`}
        required={field.required}
        deprecated={field.deprecated}
      />
      <chakra.textarea
        id={id}
        data-body-field={field.key}
        className="docs-json-field"
        defaultValue={value}
        rows={Math.max(2, value.split("\n").length)}
        placeholder="JSON"
        aria-describedby={field.description ? `${id}-hint` : undefined}
        aria-required={field.required || undefined}
        display="block"
        width="100%"
        fontFamily="mono"
        fontSize="13px"
        lineHeight="20px"
        paddingX="3"
        paddingY="2"
        bg="bg.nested"
        borderWidth="1px"
        borderColor="border"
        borderRadius="md"
        resize="vertical"
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        _focusVisible={{
          outline: "none",
          borderColor: "accent.fg",
          boxShadow: "0 0 0 1px var(--chakra-colors-accent-fg)",
        }}
      />
      <FieldHint id={`${id}-hint`} text={field.description} utc={false} />
    </Box>
  );
}

function GroupBodyField({ field, entries }: { field: GroupField; entries: FormEntries }) {
  return (
    <chakra.fieldset
      id={idOf({ field })}
      minWidth="0"
      margin="0"
      padding="0"
      paddingLeft="3"
      border="0"
      borderLeftWidth="2px"
      borderColor="border"
      {...FULL_ROW}
    >
      <FieldLabel
        as="legend"
        name={field.name}
        typeLabel="object"
        required={field.required}
        deprecated={field.deprecated}
      />
      {field.description ? (
        <FieldHint id={`${idOf({ field })}-hint`} text={field.description} utc={false} />
      ) : null}
      <BodyFields fields={field.fields} entries={entries} />
    </chakra.fieldset>
  );
}

function BodyField({ field, entries }: { field: FormField; entries: FormEntries }) {
  if (isScalar(field)) return <ScalarBodyField field={field} entries={entries} />;
  if (field.kind === "list") return <ListBodyField field={field} entries={entries} />;
  if (field.kind === "group") return <GroupBodyField field={field} entries={entries} />;
  return <JsonBodyField field={field} entries={entries} />;
}

/** Required fields first, each group in the schema's order. */
function BodyFields({ fields, entries }: { fields: FormField[]; entries: FormEntries }) {
  const ordered = [
    ...fields.filter((field) => field.required),
    ...fields.filter((field) => !field.required),
  ];
  return (
    <Box
      className="docs-request-fields"
      display="flex"
      flexDirection="column"
      gap="4"
      marginTop="2"
    >
      {ordered.map((field) => (
        <BodyField key={field.key} field={field} entries={entries} />
      ))}
    </Box>
  );
}

/** The request body as a form built from its schema; the island keeps `#pg-body` in step. */
export function BodyForm({
  form,
  entries,
  extra,
}: {
  form: GroupField;
  entries: FormEntries;
  extra: Record<string, unknown>;
}) {
  return (
    <div
      data-body-form=""
      data-body-extra={Object.keys(extra).length ? JSON.stringify(extra) : undefined}
    >
      <BodyFields fields={form.fields} entries={entries} />
    </div>
  );
}
