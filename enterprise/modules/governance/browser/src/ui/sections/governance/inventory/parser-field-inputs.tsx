// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Input, Textarea } from "@langwatch/design-system/primitives";
import { Switch } from "@langwatch/design-system/switch";

import { DashboardSelect } from "../../../../features/ingestion-sources/dashboard-select.tsx";
import {
  dateInputValue,
  type FieldControl,
  type FieldOption,
  switchFieldIsOn,
  switchReadOnlyLabel,
} from "./parser-field-controls.ts";

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

  // Same reasoning as `ParserSelectInput` above: a switch has no readOnly
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

type ParserFieldInputProps = {
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
};

/** A multi-line value, in monospace. */
function ParserTextareaInput({
  ariaLabel,
  isInvalid,
  placeholder,
  readOnly,
  value,
  onChange,
}: ParserFieldInputProps) {
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
      {...invalidInputStyles(isInvalid)}
    />
  );
}

/** A calendar day, shown as the date part of whatever is held. */
function ParserDateInput({
  ariaLabel,
  isInvalid,
  readOnly,
  value,
  onChange,
}: ParserFieldInputProps) {
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
      {...invalidInputStyles(isInvalid)}
    />
  );
}

/** A single-line value, masked when it is a secret. */
function ParserTextInput({
  ariaLabel,
  isInvalid,
  isSecret,
  placeholder,
  readOnly,
  value,
  onChange,
}: ParserFieldInputProps) {
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
      // textarea and date inputs are read-only the same way.
      readOnly={readOnly}
      {...invalidInputStyles(isInvalid)}
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
export function ParserFieldInput(props: ParserFieldInputProps) {
  const { ariaLabel, control, fieldKey, isInvalid, isMultiline, readOnly, value, onChange } = props;

  if (isMultiline) return <ParserTextareaInput {...props} />;

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

  if (control.kind === "date") return <ParserDateInput {...props} />;

  return <ParserTextInput {...props} />;
}
