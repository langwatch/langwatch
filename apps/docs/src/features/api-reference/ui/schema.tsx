import { Badge, Box, Flex, Text } from "@langwatch/design-system/primitives";

import { DocsField, Expandable } from "../../content/ui.ts";
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

  if (schema.minLength !== undefined) out.push(`At least ${schema.minLength} characters`);
  if (schema.maxLength !== undefined) out.push(`Up to ${schema.maxLength} characters`);
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

function Children({ schema, depth }: { schema: Schema; depth: number }) {
  if (depth >= MAX_DEPTH) return null;
  const target = schema.type === "array" && schema.items ? schema.items : schema;
  const merged = mergeAllOf({ schema: target });
  if (merged.$recursive)
    return (
      <Text margin="0" fontSize="13px" color="fg.muted">
        Recursive: see {merged.$recursive}
      </Text>
    );
  const options = merged.oneOf ?? merged.anyOf;
  if (options) {
    return (
      <>
        {options.map((option, index) => (
          <Box key={index} marginBottom="2">
            <Text margin="0" fontSize="13px" color="fg.muted">
              Option {index + 1}: {typeLabel({ schema: option })}
            </Text>
            <Children schema={option} depth={depth + 1} />
          </Box>
        ))}
      </>
    );
  }
  if (!merged.properties || Object.keys(merged.properties).length === 0) return null;
  return <SchemaFields schema={merged} depth={depth + 1} />;
}

function hasChildren({ schema }: { schema: Schema }): boolean {
  const target = schema.type === "array" && schema.items ? schema.items : schema;
  const merged = mergeAllOf({ schema: target });
  return Boolean(
    merged.oneOf ||
    merged.anyOf ||
    (merged.properties && Object.keys(merged.properties).length > 0) ||
    merged.$recursive,
  );
}

export function SchemaFields({ schema, depth = 0 }: { schema: Schema; depth?: number }) {
  const merged = mergeAllOf({ schema });
  const entries = Object.entries(merged.properties ?? {});
  if (entries.length === 0 && hasChildren({ schema: merged }))
    return (
      <Box>
        <SchemaNote schema={merged} />
        <Children schema={merged} depth={depth} />
      </Box>
    );
  if (entries.length === 0) return <SchemaNote schema={merged} />;
  return (
    <Box>
      {entries.map(([name, child]) => (
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
          {child.description ? <p>{child.description}</p> : null}
          {child.enum ? (
            <Flex gap="1.5" wrap="wrap" fontSize="12px" alignItems="baseline">
              <span>One of</span>
              {child.enum.map((value, index) => (
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
          {hasChildren({ schema: child }) ? (
            <Expandable
              defaultOpen={depth === 0}
              title={`${Object.keys(child.properties ?? child.items?.properties ?? {}).length || "nested"} child attributes`}
            >
              <Children schema={child} depth={depth} />
            </Expandable>
          ) : null}
        </DocsField>
      ))}
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
          {param.description ? <p>{param.description}</p> : null}
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
