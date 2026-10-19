import { Checkbox, Input, Panel, Select, Stack, Textarea } from "@langwatch/design-system-internal";
import type { JSX } from "react";

/**
 * A form drawn from the props schema. Walks JSON Schema, not zod's
 * internals, to keep working across a zod upgrade, and stops honestly at
 * the first unrecognised shape — a JSON box, not a control editing the wrong thing.
 */

type Node = Record<string, unknown>;

/** The kit's labels are plain text, so "optional" rides on the label itself. */
const labelFor = ({ label, required }: { label: string; required: boolean }): string =>
  required ? label : `${label} (optional)`;

const isObject = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Follows `$ref` into the document's `$defs`, which is where zod puts reuse. */
const deref = (node: Node, root: Node): Node => {
  const ref = node.$ref;
  if (typeof ref !== "string" || !ref.startsWith("#/")) return node;
  const resolved = ref
    .slice(2)
    .split("/")
    .reduce<unknown>((carry, key) => (isObject(carry) ? carry[key] : undefined), root);
  return isObject(resolved) ? resolved : node;
};

/** `.optional()` and `.nullable()` arrive as a union; the useful branch is the other one. */
const unwrapNullable = (node: Node): Node => {
  const branches = node.anyOf ?? node.oneOf;
  if (!Array.isArray(branches)) return node;
  const real = branches.filter((branch) => isObject(branch) && branch.type !== "null");
  return real.length === 1 && isObject(real[0])
    ? { ...real[0], ...(node.description ? { description: node.description } : {}) }
    : node;
};

const setIn = (target: unknown, path: readonly string[], value: unknown): unknown => {
  const [head, ...rest] = path;
  if (head === undefined) return value;
  const base = isObject(target) ? target : {};
  return { ...base, [head]: setIn(base[head], rest, value) };
};

const getIn = (target: unknown, path: readonly string[]): unknown =>
  path.reduce<unknown>((carry, key) => (isObject(carry) ? carry[key] : undefined), target);

export const PropsForm = ({
  schema,
  props,
  onChange,
}: {
  schema: unknown;
  props: unknown;
  onChange: (next: unknown) => void;
}): JSX.Element => {
  if (!isObject(schema)) {
    return <JsonBox value={props} onChange={onChange} label="Props" />;
  }
  return (
    <Stack gap={4}>
      <Field
        node={schema}
        root={schema}
        path={[]}
        label=""
        required
        props={props}
        onChange={onChange}
      />
    </Stack>
  );
};

type FieldProps = {
  node: Node;
  root: Node;
  path: readonly string[];
  label: string;
  required: boolean;
  props: unknown;
  onChange: (next: unknown) => void;
};

/** What every kind of field reads: the resolved node, its current value and its setter. */
type FieldContext = FieldProps & {
  value: unknown;
  set: (next: unknown) => void;
  id: string;
  description: string | undefined;
};

const Field = ({
  node: raw,
  root,
  path,
  label,
  required,
  props,
  onChange,
}: FieldProps): JSX.Element => {
  const node = unwrapNullable(deref(raw, root));
  const context: FieldContext = {
    node,
    root,
    path,
    label,
    required,
    props,
    onChange,
    value: path.length === 0 ? props : getIn(props, path),
    set: (next: unknown) => onChange(setIn(props, path, next)),
    id: path.join(".") || "root",
    description: typeof node.description === "string" ? node.description : undefined,
  };

  if (Array.isArray(node.enum)) return <EnumField {...context} />;
  if (node.type === "object" && isObject(node.properties)) return <ObjectField {...context} />;
  if (node.type === "array") return <ArrayField {...context} />;
  if (node.type === "boolean") return <BooleanField {...context} />;
  if (node.type === "number" || node.type === "integer") return <NumberField {...context} />;
  if (node.type === "string") return <StringField {...context} />;
  return <JsonBox value={context.value} onChange={context.set} label={label} />;
};

const EnumField = ({
  node,
  label,
  required,
  value,
  set,
  id,
  description,
}: FieldContext): JSX.Element => {
  return (
    <Select
      id={id}
      size="sm"
      label={labelFor({ label, required })}
      hint={description}
      value={typeof value === "string" ? value : ""}
      onChange={(next) => set(next)}
      options={[
        ...(required ? [] : [{ value: "", label: "(not set)" }]),
        ...(Array.isArray(node.enum) ? node.enum : []).map((option: unknown) => ({
          value: String(option),
          label: String(option),
        })),
      ]}
    />
  );
};

const ObjectField = ({
  node,
  root,
  path,
  label,
  required,
  props,
  onChange,
}: FieldContext): JSX.Element => {
  const requiredKeys = new Set(
    Array.isArray(node.required) ? node.required.map((key) => String(key)) : [],
  );
  const properties = isObject(node.properties) ? node.properties : {};
  const body = Object.entries(properties).map(([key, child]) =>
    isObject(child) ? (
      <Field
        key={key}
        node={child}
        root={root}
        path={[...path, key]}
        label={key}
        required={requiredKeys.has(key)}
        props={props}
        onChange={onChange}
      />
    ) : null,
  );
  if (path.length === 0) return <>{body}</>;
  return (
    <Panel title={label} meta={required ? undefined : "optional"}>
      <Stack gap={4}>{body}</Stack>
    </Panel>
  );
};

const ArrayField = ({ node, root, label, required, value, set, id }: FieldContext): JSX.Element => {
  const items = unwrapNullable(deref(isObject(node.items) ? node.items : {}, root));
  if (items.type === "string") {
    const lines = Array.isArray(value) ? value.map((entry) => String(entry)) : [];
    return (
      <Textarea
        id={id}
        label={labelFor({ label, required })}
        hint="One per line"
        rows={Math.max(3, lines.length + 1)}
        value={lines.join("\n")}
        onChange={(next) => set(next.split("\n").filter((line) => line.trim() !== ""))}
      />
    );
  }
  return <JsonBox value={value} onChange={set} label={label} />;
};

const BooleanField = ({ label, value, set, id, description }: FieldContext): JSX.Element => {
  return (
    <Checkbox
      label={label}
      name={id}
      description={description}
      checked={value === true}
      onChange={(checked) => set(checked)}
    />
  );
};

const NumberField = ({
  label,
  required,
  value,
  set,
  id,
  description,
}: FieldContext): JSX.Element => {
  return (
    <Input
      id={id}
      type="number"
      size="sm"
      label={labelFor({ label, required })}
      hint={description}
      value={typeof value === "number" ? value : ""}
      onChange={(next) => set(next === "" ? undefined : Number(next))}
    />
  );
};

const StringField = ({
  label,
  required,
  value,
  set,
  id,
  description,
}: FieldContext): JSX.Element => {
  const text = typeof value === "string" ? value : "";
  const multiline = text.includes("\n") || text.length > 70;
  return multiline ? (
    <Textarea
      id={id}
      label={labelFor({ label, required })}
      hint={description}
      rows={4}
      value={text}
      onChange={(next) => set(next)}
    />
  ) : (
    <Input
      id={id}
      type="text"
      size="sm"
      label={labelFor({ label, required })}
      hint={description}
      value={text}
      onChange={(next) => set(next === "" && !required ? undefined : next)}
    />
  );
};

/** The ending for anything the walker will not pretend to understand. */
const JsonBox = ({
  value,
  onChange,
  label,
}: {
  value: unknown;
  onChange: (next: unknown) => void;
  label: string;
}): JSX.Element => (
  <Textarea
    id={`json-${label}`}
    label={label}
    hint="JSON"
    mono
    rows={6}
    defaultValue={JSON.stringify(value ?? null, null, 2)}
    onChange={(next) => {
      try {
        onChange(JSON.parse(next));
      } catch {
        // An unfinished edit is not an error worth showing; the field keeps
        // the last value that parsed until this one does.
        return;
      }
    }}
  />
);
