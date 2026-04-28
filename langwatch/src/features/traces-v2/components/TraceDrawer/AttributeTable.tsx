import { Box, Button, HStack, Icon, Input, Text } from "@chakra-ui/react";
import { useMemo, useState } from "react";
import { LuCheck, LuCopy, LuPin, LuPinOff } from "react-icons/lu";
import { Tooltip } from "~/components/ui/tooltip";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { usePinnedAttributes } from "../../hooks/usePinnedAttributes";
import type { PinnedAttributeSource } from "../../stores/pinnedAttributesStore";
import { PinnedAwareJsonView } from "./JsonHighlight";
import { SegmentedToggle } from "./SegmentedToggle";

const EM_DASH = "\u2014";
const COPY_FEEDBACK_MS = 1500;

interface AttributeTableProps {
  attributes: Record<string, unknown>;
  resourceAttributes?: Record<string, unknown>;
  title?: string;
}

type AttrViewMode = "flat" | "json";

const VIEW_MODE_OPTIONS = ["flat", "json"] as const;

const PIN_TINT: Record<
  PinnedAttributeSource,
  { bg: string; border: string; fg: string }
> = {
  resource: { bg: "purple.subtle", border: "purple.muted", fg: "purple.fg" },
  attribute: { bg: "blue.subtle", border: "blue.muted", fg: "blue.fg" },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function flattenAttributes(
  obj: Record<string, unknown>,
  prefix = "",
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) {
      Object.assign(out, flattenAttributes(value, newKey));
    } else {
      out[newKey] = value;
    }
  }
  return out;
}

function buildNestedObject(
  attrs: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    const parts = key.split(".");
    let current: Record<string, unknown> = result;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!;
      if (!isPlainObject(current[part])) {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }
    current[parts[parts.length - 1]!] = value;
  }
  return result;
}

function formatValue(val: unknown): string {
  if (val === undefined || val === null || val === "") return EM_DASH;
  if (Array.isArray(val) || (typeof val === "object" && val !== null)) {
    return JSON.stringify(val);
  }
  return String(val);
}

function filterAttributesBySearch(
  attrs: Record<string, unknown>,
  searchTerm: string,
): Record<string, unknown> {
  const term = searchTerm.trim().toLowerCase();
  if (!term) return attrs;
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(attrs)) {
    if (
      key.toLowerCase().includes(term) ||
      formatValue(val).toLowerCase().includes(term)
    ) {
      result[key] = val;
    }
  }
  return result;
}

function PinToggle({
  pinned,
  source,
  attrKey,
  onToggle,
}: {
  pinned: boolean;
  source: PinnedAttributeSource;
  attrKey: string;
  onToggle: () => void;
}) {
  const tint = PIN_TINT[source];
  return (
    <Tooltip
      content={pinned ? "Unpin attribute" : "Pin to trace header"}
      positioning={{ placement: "top" }}
    >
      <Button
        size="xs"
        variant="ghost"
        onClick={onToggle}
        aria-label={pinned ? `Unpin ${attrKey}` : `Pin ${attrKey}`}
        aria-pressed={pinned}
        padding={0}
        minWidth="auto"
        width="20px"
        height="20px"
        marginLeft={2}
        marginRight={1.5}
        borderRadius="sm"
        borderWidth={pinned ? "1px" : "0px"}
        borderColor={pinned ? tint.border : "transparent"}
        bg={pinned ? tint.bg : "transparent"}
        opacity={pinned ? 1 : 0.4}
        transition="opacity 0.12s ease, background 0.12s ease"
        css={{ ".attr-row:hover &": { opacity: 1 } }}
        flexShrink={0}
        _hover={pinned ? { bg: tint.bg, opacity: 1 } : { bg: "bg.muted" }}
      >
        <Icon
          as={pinned ? LuPinOff : LuPin}
          boxSize={3}
          color={pinned ? tint.fg : "fg.subtle"}
        />
      </Button>
    </Tooltip>
  );
}

function CopyAllButton({ payload }: { payload: string }) {
  const [copied, setCopied] = useState(false);
  const handleClick = () => {
    void navigator.clipboard.writeText(payload);
    setCopied(true);
    setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
  };
  return (
    <Button
      size="xs"
      variant="ghost"
      onClick={handleClick}
      aria-label="Copy all attributes"
      paddingX={2}
      height="26px"
      gap={1}
    >
      <Icon
        as={copied ? LuCheck : LuCopy}
        boxSize={3}
        color={copied ? "green.fg" : "fg.subtle"}
      />
      <Text textStyle="2xs" color="fg.muted">
        {copied ? "Copied" : "Copy"}
      </Text>
    </Button>
  );
}

function FlatRow({
  attrKey,
  value,
  source,
  pinned,
  isLast,
  onTogglePin,
}: {
  attrKey: string;
  value: unknown;
  source: PinnedAttributeSource;
  pinned: boolean;
  isLast: boolean;
  onTogglePin: () => void;
}) {
  const display = formatValue(value);
  return (
    <HStack
      borderBottomWidth={isLast ? "0px" : "1px"}
      borderColor="border.muted"
      _hover={{ bg: "bg.muted" }}
      gap={0}
      paddingRight={2}
      className="attr-row"
      bg={pinned ? "bg.subtle" : undefined}
    >
      <PinToggle
        pinned={pinned}
        source={source}
        attrKey={attrKey}
        onToggle={onTogglePin}
      />
      <Text
        width="200px"
        flexShrink={0}
        textStyle="xs"
        fontFamily="mono"
        color={pinned ? "fg" : "fg.muted"}
        fontWeight={pinned ? "semibold" : "normal"}
        truncate
        paddingX={3}
        paddingY={1.5}
        bg="bg.subtle"
        borderRightWidth="1px"
        borderColor="border.muted"
        transition="color 0.12s ease, font-weight 0.12s ease"
        css={{
          // Strengthen the key column when the row is hovered so the
          // attribute name reads as the focus, not just a tint change.
          ".attr-row:hover &": { color: "fg", fontWeight: "semibold" },
        }}
      >
        {attrKey}
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
        {display}
      </Text>
      <Button
        size="xs"
        variant="ghost"
        onClick={() => void navigator.clipboard.writeText(display)}
        aria-label={`Copy ${attrKey}`}
        padding={0}
        minWidth="auto"
        height="auto"
        opacity={0}
        css={{ ".attr-row:hover &": { opacity: 1 } }}
      >
        <Icon as={LuCopy} boxSize={2.5} color="fg.subtle" />
      </Button>
    </HStack>
  );
}

function AttrSection({
  title,
  attributes,
  viewMode,
  source,
}: {
  title: string;
  attributes: Record<string, unknown>;
  viewMode: AttrViewMode;
  source: PinnedAttributeSource;
}) {
  const { project } = useOrganizationTeamProject();
  const { pins, isPinned, togglePin } = usePinnedAttributes(project?.id);

  const flat = useMemo(() => flattenAttributes(attributes), [attributes]);
  const pinnedKeys = useMemo(
    () => new Set(pins.filter((p) => p.source === source).map((p) => p.key)),
    [pins, source],
  );
  const sortedEntries = useMemo(
    () =>
      Object.entries(flat).sort(([a], [b]) => {
        const aPin = pinnedKeys.has(a) ? 0 : 1;
        const bPin = pinnedKeys.has(b) ? 0 : 1;
        if (aPin !== bPin) return aPin - bPin;
        return a.localeCompare(b);
      }),
    [flat, pinnedKeys],
  );

  if (sortedEntries.length === 0) return null;

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
          {sortedEntries.map(([key, val], i) => (
            <FlatRow
              key={key}
              attrKey={key}
              value={val}
              source={source}
              pinned={isPinned(source, key)}
              isLast={i === sortedEntries.length - 1}
              onTogglePin={() => togglePin({ source, key })}
            />
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
          <PinnedAwareJsonView
            content={JSON.stringify(buildNestedObject(flat), null, 2)}
            pinnedKeys={pinnedKeys}
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
    () =>
      resourceAttributes ? flattenAttributes(resourceAttributes) : undefined,
    [resourceAttributes],
  );

  const filterAttrs = useMemo(
    () => filterAttributesBySearch(flatAttrs, searchTerm),
    [flatAttrs, searchTerm],
  );
  const filterResAttrs = useMemo(() => {
    if (!flatResAttrs) return undefined;
    const filtered = filterAttributesBySearch(flatResAttrs, searchTerm);
    return Object.keys(filtered).length > 0 ? filtered : undefined;
  }, [flatResAttrs, searchTerm]);

  const hasResourceAttrs = !!filterResAttrs;
  const spanAttrTitle = hasResourceAttrs
    ? title === "Trace Attributes"
      ? "Trace Attributes"
      : "Span Attributes"
    : "";

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
          options={VIEW_MODE_OPTIONS}
        />
        <CopyAllButton payload={copyPayload} />
      </HStack>

      <AttrSection
        title={spanAttrTitle}
        attributes={filterAttrs}
        viewMode={viewMode}
        source="attribute"
      />
      {filterResAttrs && (
        <AttrSection
          title="Resource Attributes"
          attributes={filterResAttrs}
          viewMode={viewMode}
          source="resource"
        />
      )}
    </Box>
  );
}
