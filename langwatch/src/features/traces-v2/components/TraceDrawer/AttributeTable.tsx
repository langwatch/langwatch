import { useState, useMemo } from "react";
import { Box, Button, HStack, Icon, Input, Text } from "@chakra-ui/react";
import { LuCheck, LuCopy } from "react-icons/lu";
import { SegmentedToggle } from "./SegmentedToggle";
import { JsonView } from "./JsonHighlight";

interface AttributeTableProps {
  attributes: Record<string, unknown>;
  resourceAttributes?: Record<string, unknown>;
  title?: string;
}

type AttrViewMode = "flat" | "json";

/**
 * Walks the attribute object, returning a flat key/value map where nested
 * objects become dot-notation keys (`a.b.c → "v"`). Arrays and primitives
 * are kept as-is on their leaf key.
 */
function flattenAttributes(
  obj: Record<string, unknown>,
  prefix = "",
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key;
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      Object.assign(out, flattenAttributes(value as Record<string, unknown>, newKey));
    } else {
      out[newKey] = value;
    }
  }
  return out;
}

/**
 * Groups dot-notation keys back into a nested object for the JSON view.
 * Mirrors flatten — round-trip safe for non-array values.
 */
function buildNestedObject(
  attrs: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    const parts = key.split(".");
    let current: Record<string, unknown> = result;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!;
      if (!(part in current) || typeof current[part] !== "object") {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }
    current[parts[parts.length - 1]!] = value;
  }
  return result;
}

function formatValue(val: unknown): string {
  if (val === undefined || val === null || val === "") return "\u2014";
  if (Array.isArray(val) || (typeof val === "object" && val !== null)) {
    return JSON.stringify(val);
  }
  return String(val);
}

function CopyAllButton({ payload }: { payload: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="xs"
      variant="ghost"
      onClick={() => {
        void navigator.clipboard.writeText(payload);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      aria-label="Copy all attributes"
      paddingX={2}
      height="26px"
      gap={1}
    >
      <Icon as={copied ? LuCheck : LuCopy} boxSize={3} color={copied ? "green.fg" : "fg.subtle"} />
      <Text textStyle="2xs" color="fg.muted">
        {copied ? "Copied" : "Copy"}
      </Text>
    </Button>
  );
}

function AttrSection({
  title,
  attributes,
  viewMode,
}: {
  title: string;
  attributes: Record<string, unknown>;
  viewMode: AttrViewMode;
}) {
  const flat = useMemo(() => flattenAttributes(attributes), [attributes]);
  const entries = useMemo(
    () => Object.entries(flat).sort(([a], [b]) => a.localeCompare(b)),
    [flat],
  );

  if (entries.length === 0) return null;

  return (
    <Box marginBottom={3}>
      {title && (
        <Text
          textStyle="xs"
          fontWeight="semibold"
          color="fg.muted"
          textTransform="uppercase"
          letterSpacing="0.08em"
          marginBottom={1.5}
        >
          {title}
        </Text>
      )}
      {viewMode === "flat" ? (
        <Box
          borderRadius="md"
          borderWidth="1px"
          borderColor="border"
          overflow="hidden"
          bg="bg.panel"
        >
          {entries.map(([key, val], i) => (
            <HStack
              key={key}
              borderBottomWidth={i < entries.length - 1 ? "1px" : "0px"}
              borderColor="border.muted"
              _hover={{ bg: "bg.muted" }}
              gap={0}
              paddingRight={2}
              className="attr-row"
            >
              <Text
                width="220px"
                flexShrink={0}
                textStyle="xs"
                fontFamily="mono"
                color="fg.muted"
                truncate
                paddingX={3}
                paddingY={1.5}
                bg="bg.subtle"
                borderRightWidth="1px"
                borderColor="border.muted"
              >
                {key}
              </Text>
              <Text
                flex={1}
                textStyle="xs"
                fontFamily="mono"
                color="fg"
                truncate
                minWidth={0}
                paddingX={3}
                paddingY={1.5}
              >
                {formatValue(val)}
              </Text>
              <Button
                size="xs"
                variant="ghost"
                onClick={() =>
                  void navigator.clipboard.writeText(formatValue(val))
                }
                aria-label={`Copy ${key}`}
                padding={0}
                minWidth="auto"
                height="auto"
                opacity={0}
                css={{ ".attr-row:hover &": { opacity: 1 } }}
              >
                <Icon as={LuCopy} boxSize={2.5} color="fg.subtle" />
              </Button>
            </HStack>
          ))}
        </Box>
      ) : (
        <Box
          bg="bg.panel"
          borderRadius="md"
          borderWidth="1px"
          borderColor="border"
          padding={3}
          maxHeight="320px"
          overflow="auto"
        >
          <JsonView
            content={JSON.stringify(buildNestedObject(flat), null, 2)}
          />
        </Box>
      )}
    </Box>
  );
}

export function AttributeTable({
  attributes,
  resourceAttributes,
  title,
}: AttributeTableProps) {
  const [viewMode, setViewMode] = useState<AttrViewMode>("flat");
  const [searchTerm, setSearchTerm] = useState("");

  const flatAttrs = useMemo(() => flattenAttributes(attributes), [attributes]);
  const flatResAttrs = useMemo(
    () => (resourceAttributes ? flattenAttributes(resourceAttributes) : undefined),
    [resourceAttributes],
  );

  const filterAttrs = useMemo(() => {
    if (!searchTerm.trim()) return flatAttrs;
    const term = searchTerm.toLowerCase();
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(flatAttrs)) {
      if (
        key.toLowerCase().includes(term) ||
        formatValue(val).toLowerCase().includes(term)
      ) {
        result[key] = val;
      }
    }
    return result;
  }, [flatAttrs, searchTerm]);

  const filterResAttrs = useMemo(() => {
    if (!flatResAttrs) return undefined;
    if (!searchTerm.trim()) return flatResAttrs;
    const term = searchTerm.toLowerCase();
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(flatResAttrs)) {
      if (
        key.toLowerCase().includes(term) ||
        formatValue(val).toLowerCase().includes(term)
      ) {
        result[key] = val;
      }
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }, [flatResAttrs, searchTerm]);

  const hasResourceAttrs =
    filterResAttrs && Object.keys(filterResAttrs).length > 0;
  const spanAttrTitle = hasResourceAttrs
    ? title === "Trace Attributes"
      ? "Trace Attributes"
      : "Span Attributes"
    : "";

  // Build payload for "Copy all" — uses nested form for readability
  const copyPayload = useMemo(() => {
    const root: Record<string, unknown> = {
      ...buildNestedObject(filterAttrs),
    };
    if (filterResAttrs) {
      root.resource = buildNestedObject(filterResAttrs);
    }
    return JSON.stringify(root, null, 2);
  }, [filterAttrs, filterResAttrs]);

  return (
    <Box>
      <HStack gap={2} marginBottom={2}>
        <Input
          size="xs"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Filter attributes…"
          flex={1}
          fontFamily="mono"
          borderColor="border.muted"
          _focus={{ borderColor: "border.emphasized" }}
        />
        <SegmentedToggle
          value={viewMode}
          onChange={(m) => setViewMode(m as AttrViewMode)}
          options={["flat", "json"]}
        />
        <CopyAllButton payload={copyPayload} />
      </HStack>

      <AttrSection
        title={spanAttrTitle}
        attributes={filterAttrs}
        viewMode={viewMode}
      />
      {hasResourceAttrs && filterResAttrs && (
        <AttrSection
          title="Resource Attributes"
          attributes={filterResAttrs}
          viewMode={viewMode}
        />
      )}
    </Box>
  );
}
