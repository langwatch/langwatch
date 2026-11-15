// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { FieldInfoTooltip } from "@langwatch/design-system/field-info-tooltip";
import {
  Collapsible,
  HStack,
  Input,
  Text,
  Textarea,
  VStack,
} from "@langwatch/design-system/primitives";
import { SmallLabel } from "@langwatch/design-system/small-label";
import { Switch } from "@langwatch/design-system/switch";
import { ChevronDown } from "lucide-react";
import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";

import { DashboardSelect } from "../../../features/ingestion-sources/dashboard-select.tsx";
import type { SourceType } from "../../../features/ingestion-sources/model/ingestion-source-catalog.ts";
import {
  dateInputValue,
  fieldControl,
  type FieldControl,
  type FieldDef,
  type FieldOption,
  type ParserConfigMode,
  parserFieldPresentation,
  reconcileParserValues,
  switchFieldIsOn,
  switchReadOnlyLabel,
  visibleParserFields,
} from "./parser-fields.ts";

/**
 * What a bare input looks like once the form has refused to save because of it.
 *
 * The border, not just a sentence underneath: a toast saying some value is
 * wrong leaves the admin to audit a form of a dozen fields, so the offending
 * control has to be the thing that looks wrong. Spread onto the element rather
 * than passed as a prop, because these are bare Chakra inputs — there is no
 * `Field.Root` around them to carry an `invalid` state down. `aria-invalid`
 * rides along because a red border a screen reader cannot see is not a
 * rejection anyone was told about.
 */
function invalidInputStyles(isInvalid: boolean) {
  return isInvalid
    ? ({
        borderColor: "red.fg",
        _hover: { borderColor: "red.fg" },
        "aria-invalid": true,
      } as const)
    : {};
}

/**
 * A choice, rendered as the dashboard's own picker.
 *
 * Its own component for the same reason `ParserSwitchInput` is: the read-only
 * case is not the same control with an attribute set, it is a different
 * element, and that branch reads better beside the control it stands in for
 * than as a third early return inside `ParserFieldInput`.
 */
function ParserSelectInput({
  ariaLabel,
  isInvalid,
  options,
  readOnly,
  value,
  onChange,
}: {
  ariaLabel: string;
  isInvalid: boolean;
  options: readonly FieldOption[];
  readOnly: boolean;
  value: string;
  onChange: (next: string) => void;
}) {
  // A select has no readOnly — HTML ignores the attribute on the native one,
  // and `disabled` is the only thing that would stop the change, at the cost
  // of dropping the field out of the tab order. So a locked choice is shown
  // as its own label in a readOnly input instead: genuinely unchangeable, and
  // still reachable and readable, which is the rule every branch here keeps.
  if (readOnly) {
    const chosen = options.find((option) => option.value === value);
    return <Input size="sm" aria-label={ariaLabel} value={chosen?.label ?? value} readOnly />;
  }

  return (
    <DashboardSelect
      ariaLabel={ariaLabel}
      options={options}
      value={value}
      invalid={isInvalid}
      onChange={onChange}
    />
  );
}

/**
 * A two-state setting, rendered as a toggle.
 *
 * Its own component rather than another branch in `ParserFieldInput` because
 * it is the only control whose displayed state is derived rather than held:
 * the form stores a string that can be absent, and absent means the field's
 * declared default. That derivation belongs beside the toggle that shows it.
 */
function ParserSwitchInput({
  ariaLabel,
  control,
  fieldKey,
  readOnly,
  value,
  onChange,
}: {
  ariaLabel: string;
  /**
   * The resolved switch control, rather than its parts.
   *
   * It carries four things that have to agree — the default, the two values
   * written, and the two labels shown when locked — and passing them
   * separately is how a caller comes to hand this one field's default beside
   * another's values.
   */
  control: Extract<FieldControl, { kind: "switch" }>;
  fieldKey: string;
  readOnly: boolean;
  value: string;
  onChange: (next: string) => void;
}) {
  const on = switchFieldIsOn({
    value,
    defaultOn: control.defaultOn,
    onValue: control.onValue,
    offValue: control.offValue,
  });

  // Same reasoning as the select branch below: a switch has no readOnly
  // either, and `disabled` would drop it out of the tab order where a keyboard
  // or screen-reader user could not read what it holds. So a locked toggle is
  // shown as its own state in a readOnly input instead — in the words of the
  // setting where it has any, since "Off" is the position of a control this
  // admin can no longer see.
  if (readOnly) {
    return (
      <Input
        size="sm"
        aria-label={ariaLabel}
        value={switchReadOnlyLabel({ control, value })}
        readOnly
      />
    );
  }

  return (
    <Switch
      colorPalette="accent"
      checked={on}
      // Never blank: blank means the field's declared default, which is not
      // always off, so writing it back would flip a deliberate choice. And the
      // field's own two values, not the boolean strings — the Anthropic report
      // is a toggle over "cost" and "usage".
      onCheckedChange={({ checked }) => onChange(checked ? control.onValue : control.offValue)}
      // The field label beside this is a heading, not a bound <label>, so the
      // accessible name has to come from the control itself.
      inputProps={{
        "aria-label": ariaLabel,
        "data-testid": `parser-switch-${fieldKey}`,
      }}
    />
  );
}

/**
 * The input itself, chosen by control kind.
 *
 * Split from `ParserConfigField` so the label, the required marker and the hint
 * are decided in one place and the control in another — the two were growing a
 * shared ternary chain, which is how a field ends up rendering one control and
 * labelling another.
 */
function ParserFieldInput({
  ariaLabel,
  control,
  fieldKey,
  isInvalid,
  isMultiline,
  isSecret,
  placeholder,
  readOnly,
  value,
  onChange,
}: {
  /**
   * The field's label.
   *
   * Every branch reads it. The label beside a field is a heading rather than a
   * bound `<label>`, so without it none of these controls has an accessible
   * name at all — a screen reader announcing "edit text, blank" beside a
   * heading it has no way to connect. The switch was the only branch that used
   * to carry one, which made it the only field on the form a non-sighted admin
   * could identify.
   */
  ariaLabel: string;
  control: FieldControl;
  fieldKey: string;
  /** The save was refused because this field is empty. */
  isInvalid: boolean;
  isMultiline: boolean;
  isSecret: boolean;
  placeholder: string;
  readOnly: boolean;
  value: string;
  onChange: (next: string) => void;
}) {
  const invalidStyles = invalidInputStyles(isInvalid);

  if (isMultiline) {
    return (
      <Textarea
        size="sm"
        rows={6}
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        fontFamily="mono"
        readOnly={readOnly}
        {...invalidStyles}
      />
    );
  }

  if (control.kind === "select") {
    return (
      <ParserSelectInput
        ariaLabel={ariaLabel}
        isInvalid={isInvalid}
        options={control.options}
        readOnly={readOnly}
        value={value}
        onChange={onChange}
      />
    );
  }

  if (control.kind === "switch") {
    return (
      <ParserSwitchInput
        ariaLabel={ariaLabel}
        control={control}
        fieldKey={fieldKey}
        readOnly={readOnly}
        value={value}
        onChange={onChange}
      />
    );
  }

  if (control.kind === "date") {
    return (
      <Input
        size="sm"
        type="date"
        aria-label={ariaLabel}
        // Display-only truncation — see `dateInputValue`. The held value stays
        // whatever was stored until the admin picks a different day.
        value={dateInputValue(value)}
        onChange={(e) => onChange(e.target.value)}
        readOnly={readOnly}
        {...invalidStyles}
      />
    );
  }

  return (
    <Input
      size="sm"
      type={isSecret ? "password" : "text"}
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      // readOnly, never disabled: a locked field is shown precisely so the
      // admin can read what it holds, and `disabled` drops it out of the tab
      // order where a keyboard or screen-reader user cannot reach it. The
      // Textarea branch above says the same thing.
      readOnly={readOnly}
      {...invalidStyles}
    />
  );
}

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
  // `fieldControl` builds a fresh options array every call, and a select below
  // hands it straight to `DashboardSelect`, whose collection is keyed on that
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

/**
 * The one collapsed group a source drawer offers.
 *
 * Unmounted while closed, so the collapsed state genuinely holds nothing the
 * admin needs: create must produce a working source without it ever being
 * opened. Which is also the constraint on what goes in — anything here that
 * kept its own state would throw the admin's choice away on every collapse,
 * so every child is driven from the drawer's state.
 *
 * Extracted rather than left inside `ParserConfigFields` because the edit
 * drawer reaches the group down a path that renders no parser fields at all:
 * the two source types that route conversations are both absent from
 * `EDITABLE_PULL_CONFIG_SOURCE_TYPES`, so their destination has to be grouped
 * by something that does not belong to the parser config.
 */
export function AdvancedSettingsGroup({
  children,
  openWhen = false,
}: {
  children: ReactNode;
  /**
   * A demand from outside that the group be open — raised when a refused save
   * marked a field inside it.
   *
   * One-way on purpose. It opens the group and never closes it, so a caller
   * whose demand goes away does not slam shut a group the admin has since
   * opened for themselves. Expansion otherwise stays this component's own
   * business, which is what lets the caller with nothing to demand render it
   * with no props at all.
   */
  openWhen?: boolean;
}) {
  const [isOpen, setOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (openWhen) setOpen(true);
  }, [openWhen]);

  // The trigger sits at the bottom of a drawer that is already taller than its
  // viewport, so expanding it otherwise opens the settings below the fold and
  // leaves the admin looking at the button they just pressed, with no sign
  // anything happened. Deferred one frame because the collapsible measures its
  // content on the tick it opens, and a scroll issued before that measurement
  // lands against the collapsed height.
  useEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => {
      contentRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen]);

  return (
    <Collapsible.Root
      // Still unmounted while closed, which is what the rule above about
      // caller-owned state pays for. The model-provider drawer this is
      // modelled on keeps its content mounted; matching its LOOK is the point,
      // not its mounting, and mounting a dozen hidden inputs into every source
      // drawer would buy nothing.
      lazyMount
      unmountOnExit
      open={isOpen}
      onOpenChange={({ open }) => setOpen(open)}
      borderTopWidth="1px"
      borderColor="border.muted"
    >
      {/* A full-width row with the label on the left and the chevron on the
          right, matching the model-provider drawer's Advanced section. It read
          as a small grey button before, which put the one control on the form
          that opens more form in the same visual class as Cancel. */}
      <Collapsible.Trigger
        width="full"
        paddingY={2}
        cursor="pointer"
        _hover={{ "& svg": { color: "fg" } }}
      >
        <HStack width="full" justify="space-between">
          <SmallLabel>Advanced</SmallLabel>
          <ChevronDown
            size={14}
            // Rotated rather than swapped for a second glyph, so the open and
            // closed states are the same shape turning and not two icons an
            // eye has to tell apart.
            style={{
              color: "var(--chakra-colors-fg-muted)",
              transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 150ms ease",
            }}
          />
        </HStack>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <VStack ref={contentRef} align="stretch" gap={3} paddingTop={2} paddingBottom={2}>
          {children}
        </VStack>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

export function ParserConfigFields({
  sourceType,
  values,
  onChange,
  mode = "create",
  readOnlyKeys,
  invalidKeys,
  advancedExtras,
}: {
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
}) {
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
      {primaryFields.map((f, i) => (
        <Fragment key={f.key}>
          {f.group && f.group !== primaryFields[i - 1]?.group && (
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
      ))}
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
