import { Badge, Box, Flex, Text } from "@langwatch/design-system/primitives";

import { DocsField, Expandable, TextWithCode } from "../../content/ui.ts";
import type { Parameter, Schema } from "../model/operation.ts";

const MAX_DEPTH = 4;

export function typeLabel({ schema }: { schema: Schema }): string {
  if (schema.$recursive) return schema.$recursive;
  const options = schema.oneOf ?? schema.anyOf;
  if (options)
    return [...new Set(options.map((option) => typeLabel({ schema: option })))].join(" | ");
  if (schema.allOf) return "object";
  const base = Array.isArray(schema.type)
    ? schema.type.join(" | ")
    : (schema.type ?? (schema.properties ? "object" : "any"));
  if (base === "array" && schema.items) return `${typeLabel({ schema: schema.items })}[]`;
  return schema.format ? `${base} (${schema.format})` : base;
}

function mergeAllOf({ schema }: { schema: Schema }): Schema {
  if (!schema.allOf) return schema;
  const parts = schema.allOf.map((part) => mergeAllOf({ schema: part }));
  return {
    ...schema,
    type: "object",
    properties: Object.assign({}, ...parts.map((part) => part.properties ?? {}), schema.properties),
    required: [...parts.flatMap((part) => part.required ?? []), ...(schema.required ?? [])],
  };
}

function constraints({ schema }: { schema: Schema }): string[] {
  const out: string[] = [];

  if (schema.minLength !== undefined)
    out.push(`At least ${schema.minLength} character${schema.minLength === 1 ? "" : "s"}`);
  if (schema.maxLength !== undefined)
    out.push(`Up to ${schema.maxLength} character${schema.maxLength === 1 ? "" : "s"}`);
  if (schema.minimum !== undefined) out.push(`Minimum ${schema.minimum}`);
  if (schema.maximum !== undefined) out.push(`Maximum ${schema.maximum}`);
  if (schema.pattern) out.push(`Pattern ${schema.pattern}`);
  return out;
}

function opensObject({ schema }: { schema: Schema }): boolean {
  return (
    schema.additionalProperties === true ||
    (typeof schema.additionalProperties === "object" && schema.additionalProperties !== null)
  );
}

export function SchemaNote({ schema }: { schema: Schema }) {
  const merged = mergeAllOf({ schema });
  const count = Object.keys(merged.properties ?? {}).length;
  return (
    <Flex alignItems="center" gap="2" wrap="wrap" paddingY="3" fontSize="14px" lineHeight="24px">
      <Box as="code" fontFamily="mono" fontSize="13px">
        {typeLabel({ schema: merged })}
      </Box>
      {opensObject({ schema: merged }) ? (
        <Badge size="sm" variant="subtle" colorPalette="gray">
          Additional properties allowed
        </Badge>
      ) : null}
      {count === 0 && !merged.items && !merged.oneOf && !merged.anyOf ? (
        <Text as="span" color="fg.muted">
          No properties are declared in the schema.
        </Text>
      ) : null}
    </Flex>
  );
}

/** The schema a field's children come from: an array's items, with `allOf` parts merged. */
function childTarget({ schema }: { schema: Schema }): Schema {
  return mergeAllOf({ schema: schema.type === "array" && schema.items ? schema.items : schema });
}

/** A `const` (or single-value enum) property that tells union options apart, as `kind: "span"`. */
function discriminator({ schema }: { schema: Schema }): string | undefined {
  for (const [name, child] of Object.entries(schema.properties ?? {})) {
    const value = child.const ?? (child.enum?.length === 1 ? child.enum[0] : void 0);
    if (value !== void 0) return `${name}: ${JSON.stringify(value)}`;
  }
  return void 0;
}

/* Union options read as one group: each option is a labelled block on a left rule. */
function Options({
  options,
  depth,
  labelled,
}: {
  options: Schema[];
  depth: number;
  labelled: boolean;
}) {
  return (
    <Box className="docs-schema-options" marginTop="1">
      {labelled ? (
        <Box
          fontSize="12px"
          lineHeight="16px"
          fontWeight="500"
          color="fg.muted"
          textTransform="uppercase"
          letterSpacing="0.04em"
          marginTop="2"
        >
          One of {options.length}
        </Box>
      ) : null}
      {options.map((option, index) => {
        const merged = mergeAllOf({ schema: option });
        const name = merged.title ?? discriminator({ schema: merged });
        return (
          <Box
            key={index}
            borderInlineStartWidth="1px"
            borderColor="border.emphasized"
            paddingInlineStart="4"
            marginTop="3"
          >
            <Flex alignItems="baseline" gap="2" wrap="wrap" fontSize="13px" lineHeight="20px">
              <Text as="span" margin="0" fontWeight="600" color="fg">
                Option {index + 1}
              </Text>
              {name ? (
                <Box as="code" fontFamily="mono" fontSize="12px" color="fg">
                  {name}
                </Box>
              ) : null}
              <Box as="code" fontFamily="mono" fontSize="12px" color="fg.muted">
                {typeLabel({ schema: option })}
              </Box>
            </Flex>
            {merged.description ? (
              <Box marginTop="1" fontSize="13px" lineHeight="20px" color="docs.body">
                <TextWithCode text={merged.description} />
              </Box>
            ) : null}
            <Children schema={option} depth={depth} />
          </Box>
        );
      })}
    </Box>
  );
}

/* `labelled` names a union "One of N" where no disclosure above has already counted it. */
function Children({
  schema,
  depth,
  labelled = false,
}: {
  schema: Schema;
  depth: number;
  labelled?: boolean;
}) {
  if (depth >= MAX_DEPTH) return null;
  const merged = childTarget({ schema });
  if (merged.$recursive) return <Recursive name={merged.$recursive} />;
  const options = merged.oneOf ?? merged.anyOf;
  if (options) return <Options options={options} depth={depth} labelled={labelled} />;
  if (!merged.properties || Object.keys(merged.properties).length === 0) return null;
  return <SchemaFields schema={merged} depth={depth + 1} />;
}

function Recursive({ name }: { name: string }) {
  return (
    <Box marginTop="1" fontSize="13px" lineHeight="20px" color="fg.muted">
      Recursive: same shape as{" "}
      <Box as="code" fontFamily="mono">
        {name}
      </Box>
    </Box>
  );
}

/** What a field's disclosure opens onto, counted: "3 child attributes", "2 variants". */
function childSummary({ schema }: { schema: Schema }): string | undefined {
  const merged = childTarget({ schema });
  if (merged.$recursive) return void 0;
  const options = merged.oneOf ?? merged.anyOf;
  if (options) return `${options.length} ${options.length === 1 ? "variant" : "variants"}`;
  const count = Object.keys(merged.properties ?? {}).length;
  if (count === 0) return void 0;
  return `${count} child ${count === 1 ? "attribute" : "attributes"}`;
}

export function SchemaFields({ schema, depth = 0 }: { schema: Schema; depth?: number }) {
  const merged = mergeAllOf({ schema });
  const entries = Object.entries(merged.properties ?? {});
  const target = childTarget({ schema: merged });
  const union = Boolean(target.oneOf ?? target.anyOf);
  const nested =
    union || Boolean(target.$recursive) || Object.keys(target.properties ?? {}).length > 0;
  if (entries.length === 0 && nested)
    return (
      <Box>
        {merged.oneOf || merged.anyOf ? null : <SchemaNote schema={merged} />}
        <Children schema={merged} depth={depth} labelled />
      </Box>
    );
  if (entries.length === 0) return <SchemaNote schema={merged} />;
  return (
    <Box>
      {entries.map(([name, child]) => {
        const summary = childSummary({ schema: child });
        const recursive = childTarget({ schema: child }).$recursive;
        const values = child.enum ?? (child.const === void 0 ? void 0 : [child.const]);
        return (
          <DocsField
            key={name}
            name={name}
            type={typeLabel({ schema: child })}
            kind="param"
            location=""
            required={merged.required?.includes(name)}
            deprecated={child.deprecated}
            default={child.default === void 0 ? void 0 : JSON.stringify(child.default)}
          >
            {child.description ? (
              <p>
                <TextWithCode text={child.description} />
              </p>
            ) : null}
            {values ? (
              <Flex gap="1.5" wrap="wrap" fontSize="12px" alignItems="baseline">
                <span>{child.enum ? "One of" : "Always"}</span>
                {values.map((value, index) => (
                  <Box key={index} as="code" bg="bg.subtle" borderRadius="sm" paddingX="1.5">
                    {JSON.stringify(value)}
                  </Box>
                ))}
              </Flex>
            ) : null}
            <Flex gap="2" wrap="wrap" fontSize="12px" color="docs.body">
              {constraints({ schema: child }).map((line) => (
                <Box key={line} as="span">
                  {line}
                </Box>
              ))}
            </Flex>
            {recursive ? <Recursive name={recursive} /> : null}
            {summary && depth < MAX_DEPTH ? (
              <Expandable defaultOpen={depth === 0} title={summary}>
                <Children schema={child} depth={depth} />
              </Expandable>
            ) : null}
          </DocsField>
        );
      })}
    </Box>
  );
}

export function ParameterFields({ parameters }: { parameters: Parameter[] }) {
  return (
    <Box>
      {parameters.map((param) => (
        <DocsField
          key={`${param.in}:${param.name}`}
          name={param.name}
          type={typeLabel({ schema: param.schema })}
          kind="param"
          location=""
          required={param.required}
          deprecated={param.deprecated}
        >
          {param.description ? (
            <p>
              <TextWithCode text={param.description} />
            </p>
          ) : null}
          <Flex gap="2" wrap="wrap" fontSize="12px" color="docs.body">
            {constraints({ schema: param.schema }).map((line) => (
              <Box key={line} as="span">
                {line}
              </Box>
            ))}
          </Flex>
        </DocsField>
      ))}
    </Box>
  );
}
