// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { FieldInfoTooltip } from "@langwatch/design-system/field-info-tooltip";
import { HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { Fragment, type ReactNode, useEffect } from "react";

import type { SourceType } from "../../../../features/ingestion-sources/model/ingestion-source-catalog.ts";
import { AdvancedSettingsGroup } from "./advanced-settings-group.tsx";
import { fieldControl, type FieldDef, type ParserConfigMode } from "./parser-field-controls.ts";
import { ParserFieldInput } from "./parser-field-inputs.tsx";
import {
  parserFieldPresentation,
  reconcileParserValues,
  visibleParserFields,
} from "./parser-fields.ts";

function ParserConfigField({
  field,
  values,
  onChange,
  mode = "create",
  readOnly = false,
  isInvalid = false,
}: {
  field: FieldDef;
  values: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  mode?: ParserConfigMode;
  readOnly?: boolean;
  /** The save was refused because this required field is empty. */
  isInvalid?: boolean;
}) {
  const { isSecret, isMultiline, isRequired, hint, placeholder } = parserFieldPresentation({
    field,
    mode,
  });
  // `fieldControl` builds a fresh options array every call, and a select in
  // `parser-field-inputs.tsx` hands it straight to `DashboardSelect`, whose collection is keyed on that
  // array's identity — so an unmemoized call resets highlight and scroll under
  // an open dropdown. It still rebuilds when `values` change, which is correct:
  // these options are a function of the form's other answers.
  const control = fieldControl({ field, values });
  const shownHint = control.hint ?? hint;

  return (
    <VStack align="stretch" gap={1}>
      {/* The explanation sits behind the (i), never under the input: a
          paragraph per field turned this form into a wall of grey text an
          admin scrolls past. See dev/docs/best_practices/copywriting.md. */}
      <HStack gap={0} alignItems="center">
        <Text fontSize="xs" fontWeight="medium">
          {field.label}
          {isRequired && (
            <Text as="span" color="red.fg" marginLeft={1}>
              *
            </Text>
          )}
        </Text>
        {shownHint && (
          <FieldInfoTooltip description={shownHint} testId={`parser-field-info-${field.key}`} />
        )}
      </HStack>
      <ParserFieldInput
        ariaLabel={field.label}
        control={control}
        fieldKey={field.key}
        isInvalid={isInvalid}
        isMultiline={isMultiline}
        isSecret={isSecret}
        placeholder={placeholder}
        readOnly={readOnly}
        value={values[field.key] ?? ""}
        onChange={(next) => onChange({ ...values, [field.key]: next })}
      />
      {/* Under the input it belongs to, never in the toast alone. The message
          says what to do rather than restating that something is invalid —
          the red border has already said that much. */}
      {isInvalid && (
        <Text fontSize="xs" color="red.fg" data-testid={`parser-field-error-${field.key}`}>
          Enter a value: this source cannot be saved without it.
        </Text>
      )}
    </VStack>
  );
}

type ParserConfigFieldsProps = {
  sourceType: SourceType;
  values: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  mode?: ParserConfigMode;
  /**
   * Fields rendered but not editable. Used on the edit form for settings the
   * adapter can no longer act on — a backfill start once the cursor has moved
   * past it is accepted and then ignored, and an input that silently does
   * nothing is worse than no input at all.
   */
  readOnlyKeys?: readonly string[];
  /**
   * Required fields a refused save found empty. Each is marked on the control
   * itself, and the Advanced group opens if one of them is inside it — a
   * complaint about a field nobody can see is not a complaint.
   */
  invalidKeys?: readonly string[];
  /**
   * Settings that belong in the Advanced group without being parser fields —
   * the pull cadence and the trace destination. Passed in rather than given a
   * collapsible of their own: two "Advanced" headings in one drawer would
   * leave an admin guessing which holds the thing they came for.
   *
   * Pass `undefined` when the source type offers none of them. An element
   * that happens to render nothing still counts as content here, and would
   * leave a push source's drawer showing an "Advanced" button that opens onto
   * an empty box.
   *
   * Whatever goes here must hold its value in the caller's state. The group
   * unmounts its contents when it closes, so a child holding its own would
   * silently discard the admin's choice on every collapse.
   */
  advancedExtras?: ReactNode;
};

/** The fields outside the Advanced group, each run of one group under its heading. */
function PrimaryParserFields({
  fields,
  values,
  onChange,
  mode,
  isReadOnly,
  isInvalid,
}: {
  fields: FieldDef[];
  values: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  mode: ParserConfigMode;
  isReadOnly: (key: string) => boolean;
  isInvalid: (key: string) => boolean;
}) {
  return fields.map((f, i) => (
    <Fragment key={f.key}>
      {f.group && f.group !== fields[i - 1]?.group && (
        <Text fontSize="xs" fontWeight="semibold" color="fg.muted" pt={i > 0 ? 2 : 0}>
          {f.group}
        </Text>
      )}
      <ParserConfigField
        field={f}
        values={values}
        onChange={onChange}
        mode={mode}
        readOnly={isReadOnly(f.key)}
        isInvalid={isInvalid(f.key)}
      />
    </Fragment>
  ));
}

export function ParserConfigFields({
  sourceType,
  values,
  onChange,
  mode = "create",
  readOnlyKeys,
  invalidKeys,
  advancedExtras,
}: ParserConfigFieldsProps) {
  // A held value can stop being offered without the admin touching its field —
  // switching the Anthropic report to `cost` retires every bucket width. Left
  // in place it would reject the save for a field the form no longer shows a
  // choice for, so the correction is pushed back up rather than rendered
  // around.
  useEffect(() => {
    const reconciled = reconcileParserValues({ sourceType, values });
    if (reconciled !== values) onChange(reconciled);
  }, [sourceType, values, onChange]);

  const fields = visibleParserFields({ sourceType, values });
  const primaryFields = fields.filter((f) => !f.advanced);
  const advancedFields = fields.filter((f) => f.advanced);
  const isInvalid = (key: string) => invalidKeys?.includes(key) ?? false;
  // A refusal opens the group rather than merely marking what is inside it.
  // Left closed, the admin is told the save failed and shown a form on which
  // every visible field is filled in.
  const hasInvalidAdvancedField = advancedFields.some((f) => isInvalid(f.key));

  // Extras alone are reason enough to render: a source type with no
  // parser fields of its own still has a cadence to offer.
  if (fields.length === 0 && !advancedExtras) return null;
  const isReadOnly = (key: string) => readOnlyKeys?.includes(key) ?? false;
  return (
    <VStack align="stretch" gap={3}>
      {/* The category, one step above the group headings under it. They were
          the same size, which made "Connection" read as a sibling of the
          heading that contains it rather than a division of it. */}
      {fields.length > 0 && (
        <Text fontSize="sm" fontWeight="semibold" color="fg">
          Configuration
        </Text>
      )}
      <PrimaryParserFields
        fields={primaryFields}
        values={values}
        onChange={onChange}
        mode={mode}
        isReadOnly={isReadOnly}
        isInvalid={isInvalid}
      />
      {(advancedFields.length > 0 || advancedExtras) && (
        <AdvancedSettingsGroup openWhen={hasInvalidAdvancedField}>
          {advancedFields.map((f) => (
            <ParserConfigField
              key={f.key}
              field={f}
              values={values}
              onChange={onChange}
              mode={mode}
              readOnly={isReadOnly(f.key)}
              isInvalid={isInvalid(f.key)}
            />
          ))}
          {advancedExtras}
        </AdvancedSettingsGroup>
      )}
    </VStack>
  );
}
