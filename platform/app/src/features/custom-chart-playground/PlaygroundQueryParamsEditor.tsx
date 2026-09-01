/**
 * Editor for one query's declared parameters — the validation contract
 * `validatePlaygroundQueryParams` checks a live `LW.query` call against. Each
 * row is a name, a JS type, and an optional default (the Run button's only
 * source of a value, since there is no separate "test values" input here).
 */

import {
  Box,
  Button,
  HStack,
  IconButton,
  Input,
  NativeSelect,
  Text,
} from "@chakra-ui/react";
import { Plus, Trash2 } from "lucide-react";

import type { PlaygroundQueryParameterDeclaration } from "~/server/analytics/playgroundWidgetDefinition";

const PARAM_TYPES: PlaygroundQueryParameterDeclaration["type"][] = [
  "string",
  "number",
  "boolean",
];

/** A parameter's default, typed for its own row's `type` at the time of edit. */
function coerceDefault(
  raw: string,
  type: PlaygroundQueryParameterDeclaration["type"],
): PlaygroundQueryParameterDeclaration["default"] {
  if (raw === "") return undefined;
  if (type === "number") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (type === "boolean") return raw === "true";
  return raw;
}

function defaultInputValue(
  value: PlaygroundQueryParameterDeclaration["default"],
): string {
  return value === undefined ? "" : String(value);
}

interface ParamRowProps {
  param: PlaygroundQueryParameterDeclaration;
  onChange: (next: PlaygroundQueryParameterDeclaration) => void;
  onRemove: () => void;
}

function ParamRow({ param, onChange, onRemove }: ParamRowProps) {
  return (
    <HStack gap={2}>
      <Input
        size="xs"
        placeholder="name"
        value={param.name}
        onChange={(e) => onChange({ ...param, name: e.target.value })}
        flex={1}
        minWidth={0}
      />
      <NativeSelect.Root size="xs" width="90px" flexShrink={0}>
        <NativeSelect.Field
          aria-label={`Type for parameter ${param.name || "(unnamed)"}`}
          value={param.type}
          onChange={(e) => {
            const type = e.currentTarget
              .value as PlaygroundQueryParameterDeclaration["type"];
            onChange({ ...param, type, default: undefined });
          }}
        >
          {PARAM_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </NativeSelect.Field>
      </NativeSelect.Root>
      {param.type === "boolean" ? (
        <NativeSelect.Root size="xs" width="110px" flexShrink={0}>
          <NativeSelect.Field
            aria-label={`Default for parameter ${param.name || "(unnamed)"}`}
            value={defaultInputValue(param.default)}
            onChange={(e) =>
              onChange({
                ...param,
                default: coerceDefault(e.currentTarget.value, param.type),
              })
            }
          >
            <option value="">no default</option>
            <option value="true">true</option>
            <option value="false">false</option>
          </NativeSelect.Field>
        </NativeSelect.Root>
      ) : (
        <Input
          size="xs"
          width="110px"
          flexShrink={0}
          placeholder="default"
          type={param.type === "number" ? "number" : "text"}
          value={defaultInputValue(param.default)}
          onChange={(e) =>
            onChange({
              ...param,
              default: coerceDefault(e.target.value, param.type),
            })
          }
        />
      )}
      <IconButton
        aria-label={`Remove parameter ${param.name || "(unnamed)"}`}
        size="xs"
        variant="ghost"
        onClick={onRemove}
      >
        <Trash2 />
      </IconButton>
    </HStack>
  );
}

interface PlaygroundQueryParamsEditorProps {
  params: PlaygroundQueryParameterDeclaration[];
  onChange: (params: PlaygroundQueryParameterDeclaration[]) => void;
}

export function PlaygroundQueryParamsEditor({
  params,
  onChange,
}: PlaygroundQueryParamsEditorProps) {
  return (
    <Box>
      <Text fontSize="11px" fontWeight="600" color="fg.muted" marginBottom={1}>
        Parameters
      </Text>
      {params.length === 0 && (
        <Text fontSize="12px" color="fg.muted" marginBottom={1}>
          None declared — LW.query calls for this query may pass no params.
        </Text>
      )}
      {params.map((param, index) => (
        // Rows have no stable id of their own (a name IS the identity being
        // edited, so it can't double as a React key while blank or mid-typo);
        // index is fine here since rows are only ever appended or removed by
        // clicking their own remove button, never reordered.
        <Box key={index} marginBottom={1}>
          <ParamRow
            param={param}
            onChange={(next) => {
              const updated = [...params];
              updated[index] = next;
              onChange(updated);
            }}
            onRemove={() => onChange(params.filter((_, i) => i !== index))}
          />
        </Box>
      ))}
      <Button
        size="xs"
        variant="ghost"
        onClick={() =>
          onChange([
            ...params,
            { name: "", type: "string", default: undefined },
          ])
        }
      >
        <Plus /> Add parameter
      </Button>
    </Box>
  );
}
