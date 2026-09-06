import { Box, chakra, Checkbox, Fieldset, Stack, Text, Textarea } from "@chakra-ui/react";
import type { JSX } from "react";

/**
 * A form drawn from the props schema.
 *
 * It walks JSON Schema rather than zod's internals so it keeps working across
 * a zod upgrade, and it stops at the first shape it cannot draw honestly: an
 * unrecognised node becomes a JSON box rather than a control that quietly
 * edits the wrong thing.
 */

type Node = Record<string, unknown>;

const HtmlSelect = chakra("select");
const HtmlInput = chakra("input");
const HtmlLabel = chakra("label");

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
    <Stack gap={3}>
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

const Field = ({
  node: raw,
  root,
  path,
  label,
  required,
  props,
  onChange,
}: {
  node: Node;
  root: Node;
  path: readonly string[];
  label: string;
  required: boolean;
  props: unknown;
  onChange: (next: unknown) => void;
}): JSX.Element => {
  const node = unwrapNullable(deref(raw, root));
  const value = path.length === 0 ? props : getIn(props, path);
  const set = (next: unknown) => onChange(setIn(props, path, next));
  const id = path.join(".") || "root";
  const description = typeof node.description === "string" ? node.description : undefined;

  if (Array.isArray(node.enum)) {
    return (
      <Labelled id={id} label={label} required={required} description={description}>
        <HtmlSelect
          id={id}
          value={String(value ?? "")}
          onChange={(event: React.ChangeEvent<HTMLSelectElement>) => set(event.target.value)}
          width="full"
          fontSize="xs"
          padding="1"
          borderWidth="1px"
          borderColor="border"
          borderRadius="sm"
          bg="bg.panel"
          color="fg"
        >
          {!required && <option value="">(not set)</option>}
          {node.enum.map((option) => (
            <option key={String(option)} value={String(option)}>
              {String(option)}
            </option>
          ))}
        </HtmlSelect>
      </Labelled>
    );
  }

  if (node.type === "object" && isObject(node.properties)) {
    const requiredKeys = new Set(
      Array.isArray(node.required) ? node.required.map((key) => String(key)) : [],
    );
    const body = Object.entries(node.properties).map(([key, child]) =>
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
      <Fieldset.Root borderWidth="1px" borderColor="border" borderRadius="md" padding={2.5}>
        <Fieldset.Legend fontSize="xs" fontWeight="semibold">
          {label}
          {!required && (
            <Text as="span" fontWeight="normal" color="fg.muted" marginLeft={1.5}>
              optional
            </Text>
          )}
        </Fieldset.Legend>
        <Stack gap={3}>{body}</Stack>
      </Fieldset.Root>
    );
  }

  if (node.type === "array") {
    const items = unwrapNullable(deref(isObject(node.items) ? node.items : {}, root));
    if (items.type === "string") {
      const lines = Array.isArray(value) ? value.map((entry) => String(entry)) : [];
      return (
        <Labelled id={id} label={label} required={required} description="One per line">
          <Textarea
            id={id}
            size="sm"
            fontSize="xs"
            rows={Math.max(3, lines.length + 1)}
            value={lines.join("\n")}
            onChange={(event) =>
              set(event.target.value.split("\n").filter((line) => line.trim() !== ""))
            }
          />
        </Labelled>
      );
    }
    return <JsonBox value={value} onChange={set} label={label} />;
  }

  if (node.type === "boolean") {
    return (
      <Checkbox.Root
        checked={value === true}
        onCheckedChange={(details) => set(details.checked === true)}
      >
        <Checkbox.HiddenInput id={id} />
        <Checkbox.Control>
          <Checkbox.Indicator />
        </Checkbox.Control>
        <Checkbox.Label fontSize="xs">{label}</Checkbox.Label>
      </Checkbox.Root>
    );
  }

  if (node.type === "number" || node.type === "integer") {
    return (
      <Labelled id={id} label={label} required={required} description={description}>
        <HtmlInput
          id={id}
          type="number"
          value={typeof value === "number" ? value : ""}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
            set(event.target.value === "" ? undefined : Number(event.target.value))
          }
          width="full"
          fontSize="xs"
          padding="1.5"
          borderWidth="1px"
          borderColor="border"
          borderRadius="sm"
          bg="bg.panel"
          color="fg"
        />
      </Labelled>
    );
  }

  if (node.type === "string") {
    const text = typeof value === "string" ? value : "";
    const multiline = text.includes("\n") || text.length > 70;
    return (
      <Labelled id={id} label={label} required={required} description={description}>
        {multiline ? (
          <Textarea
            id={id}
            size="sm"
            fontSize="xs"
            rows={4}
            value={text}
            onChange={(event) => set(event.target.value)}
          />
        ) : (
          <HtmlInput
            id={id}
            type="text"
            value={text}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              set(event.target.value === "" && !required ? undefined : event.target.value)
            }
            width="full"
            fontSize="xs"
            padding="1.5"
            borderWidth="1px"
            borderColor="border"
            borderRadius="sm"
            bg="bg.panel"
            color="fg"
          />
        )}
      </Labelled>
    );
  }

  return <JsonBox value={value} onChange={set} label={label} />;
};

const Labelled = ({
  id,
  label,
  required,
  description,
  children,
}: {
  id: string;
  label: string;
  required: boolean;
  description?: string | undefined;
  children: JSX.Element;
}): JSX.Element => (
  <Box>
    <HtmlLabel htmlFor={id} display="block" fontSize="xs" fontWeight="semibold" marginBottom={1}>
      {label}
      {!required && (
        <Text as="span" fontWeight="normal" color="fg.muted" marginLeft={1.5}>
          optional
        </Text>
      )}
    </HtmlLabel>
    {children}
    {description && (
      <Text fontSize="2xs" color="fg.muted" marginTop={1}>
        {description}
      </Text>
    )}
  </Box>
);

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
  <Box>
    <HtmlLabel
      htmlFor={`json-${label}`}
      display="block"
      fontSize="xs"
      fontWeight="semibold"
      marginBottom={1}
    >
      {label}
      <Text as="span" fontWeight="normal" color="fg.muted" marginLeft={1.5}>
        JSON
      </Text>
    </HtmlLabel>
    <Textarea
      id={`json-${label}`}
      size="sm"
      fontFamily="mono"
      fontSize="xs"
      rows={6}
      defaultValue={JSON.stringify(value ?? null, null, 2)}
      onChange={(event) => {
        try {
          onChange(JSON.parse(event.target.value));
        } catch {
          // An unfinished edit is not an error worth showing; the render below
          // keeps the last good value until the JSON parses again.
        }
      }}
    />
  </Box>
);
