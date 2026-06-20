import { Box, Button, HStack, Icon, Input, Text } from "@chakra-ui/react";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  LuCheck,
  LuCopy,
  LuEye,
  LuLock,
  LuPin,
  LuPinOff,
} from "react-icons/lu";
import { Tooltip } from "~/components/ui/tooltip";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { RestrictedAttribute } from "~/server/api/routers/tracesV2.schemas";
import { compileAttributePattern } from "~/server/data-privacy/attributePatternMatcher";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { usePinnedAttributes } from "../../hooks/usePinnedAttributes";
import type { PinnedAttributeSource } from "../../stores/pinnedAttributesStore";
import { AttributeValue } from "./AttributeValue";
import { PinnedAwareJsonView } from "./JsonHighlight";
import { SegmentedToggle } from "./SegmentedToggle";

const EM_DASH = "\u2014";

const LABEL_WIDTH_STORAGE_KEY = "langwatch:traces-v2:attribute-label-width";
const LABEL_WIDTH_MIN = 120;
const LABEL_WIDTH_MAX = 480;
const LABEL_WIDTH_DEFAULT = 200;

function clampLabelWidth(value: number): number {
  if (!Number.isFinite(value)) return LABEL_WIDTH_DEFAULT;
  return Math.min(
    LABEL_WIDTH_MAX,
    Math.max(LABEL_WIDTH_MIN, Math.round(value)),
  );
}

/**
 * Persisted width of the attribute-name column. Operators told us the
 * truncated `langwatch.prompt.variab\u2026` lines on prompt-heavy traces were
 * unreadable; the column is now dragable per-device so they can size it
 * to whatever fits their attribute namespace.
 */
function useLabelColumnWidth() {
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === "undefined") return LABEL_WIDTH_DEFAULT;
    const raw = window.localStorage.getItem(LABEL_WIDTH_STORAGE_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed)
      ? clampLabelWidth(parsed)
      : LABEL_WIDTH_DEFAULT;
  });

  const setAndPersist = useCallback((next: number) => {
    const clamped = clampLabelWidth(next);
    setWidth(clamped);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LABEL_WIDTH_STORAGE_KEY, String(clamped));
    }
  }, []);

  const applyDelta = useCallback((deltaPx: number) => {
    setWidth((prev) => {
      const clamped = clampLabelWidth(prev + deltaPx);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(LABEL_WIDTH_STORAGE_KEY, String(clamped));
      }
      return clamped;
    });
  }, []);

  return [width, setAndPersist, applyDelta] as const;
}

/**
 * 4px-wide drag handle that sits flush with the right border of the
 * label cell. Idle state shows the existing 1px border; on hover/drag
 * the bar turns blue, mirroring the resize affordance of the drawer's
 * pane separator (`PaneLayout`). State is tracked via a
 * `data-resize-handle-state` attribute so styling matches the rest of
 * the v2 surface without a custom theme.
 */
/**
 * Per-row 4px resize handle that sits flush with the right border of
 * the label cell. Idle state is invisible; hover/drag lights up the
 * blue stripe. Resize state lives on the shared `useLabelColumnWidth`
 * hook so dragging any row's handle resizes the whole column in
 * lockstep — visually scoped to the row the operator grabbed, but
 * functionally global.
 */
function LabelResizeHandle({
  onResize,
}: {
  onResize: (deltaPx: number) => void;
}) {
  const [state, setState] = useState<"idle" | "hover" | "drag">("idle");
  const startXRef = useRef<number | null>(null);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    startXRef.current = e.clientX;
    setState("drag");
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (state !== "drag" || startXRef.current === null) return;
    const delta = e.clientX - startXRef.current;
    startXRef.current = e.clientX;
    onResize(delta);
  };

  const handlePointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (state === "drag") {
      startXRef.current = null;
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
      setState("idle");
    }
  };

  return (
    <Box
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize attribute name column"
      data-resize-handle-state={state}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onPointerEnter={() => {
        if (state === "idle") setState("hover");
      }}
      onPointerLeave={() => {
        if (state === "hover") setState("idle");
      }}
      width="4px"
      flexShrink={0}
      cursor="col-resize"
      alignSelf="stretch"
      position="relative"
      marginRight="-1px"
      _before={{
        content: '""',
        position: "absolute",
        top: 0,
        bottom: 0,
        left: "1px",
        right: "1px",
        transition: "background 100ms ease",
        background: state === "idle" ? "transparent" : "blue.solid",
      }}
    />
  );
}

interface AttributeTableProps {
  attributes: Record<string, unknown>;
  resourceAttributes?: Record<string, unknown>;
  /**
   * Custom-attribute restrict rules for this viewer, used to mark restricted
   * rows in the span attributes section. Resource attributes are not marked.
   */
  restrictedAttributes?: RestrictedAttribute[] | null;
  title?: string;
  /**
   * When set, the span's id is injected as a synthetic leading `span_id` row
   * in the attributes table. It isn't a real OTel attribute, but operators
   * want a one-click copy of the span id straight from the table; it sorts
   * first regardless of search / pinning and can't be pinned to the header.
   */
  spanId?: string;
}

/** Synthetic, always-first row key for the injected span id. */
const SPAN_ID_KEY = "span_id";
const SPAN_ID_LEADING_KEYS = [SPAN_ID_KEY] as const;

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
  if (Array.isArray(val) || typeof val === "object") {
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

/**
 * Pin affordance for synthetic rows (span_id) that can't actually be pinned
 * to the trace header. Rendered disabled and extra-faded rather than as a
 * blank gap so the column reads consistently top-to-bottom — every row shows
 * a pin, this one is just clearly inert. A tooltip explains why.
 */
function DisabledPin({ attrKey }: { attrKey: string }) {
  return (
    <Tooltip
      content="The span id can't be pinned to the trace header"
      positioning={{ placement: "top" }}
    >
      <Box
        as="span"
        display="inline-flex"
        alignItems="center"
        justifyContent="center"
        width="20px"
        height="20px"
        marginLeft={2}
        marginRight={1.5}
        flexShrink={0}
        opacity={0.2}
        cursor="default"
        aria-disabled="true"
        aria-label={`${attrKey} can't be pinned`}
      >
        <Icon as={LuPin} boxSize={3} color="fg.subtle" />
      </Box>
    </Tooltip>
  );
}

/** How a restrict rule applies to one attribute for this viewer. */
type AttributeRestriction = { visibleTo: string; canSee: boolean };

/**
 * Per-row marker for a custom attribute under a `restrict` privacy rule. An
 * in-audience viewer (`canSee`) sees the value with an eye marker telling them
 * the audience it is limited to; otherwise the value is already redacted and a
 * lock marker names who can read it.
 */
function RestrictionMarker({ visibleTo, canSee }: AttributeRestriction) {
  return (
    <Tooltip
      content={
        canSee
          ? `Restricted attribute. You can see it because you are in the audience: ${visibleTo}.`
          : `Restricted attribute, hidden from you. Visible to: ${visibleTo}.`
      }
      positioning={{ placement: "top" }}
    >
      <Box
        as="span"
        display="inline-flex"
        alignItems="center"
        flexShrink={0}
        color="fg.muted"
        cursor="default"
        aria-label={
          canSee
            ? `Restricted attribute, visible to ${visibleTo}`
            : `Restricted attribute, hidden, visible to ${visibleTo}`
        }
      >
        <Icon as={canSee ? LuEye : LuLock} boxSize={3} />
      </Box>
    </Tooltip>
  );
}

function CopyAllButton({ payload }: { payload: string }) {
  const { copied, copy } = useCopyToClipboard();
  const handleClick = () => copy(payload);
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
  pinnable = true,
  isLast,
  onTogglePin,
  labelWidth,
  onLabelResize,
  restriction,
}: {
  attrKey: string;
  value: unknown;
  source: PinnedAttributeSource;
  pinned: boolean;
  pinnable?: boolean;
  isLast: boolean;
  onTogglePin: () => void;
  labelWidth: number;
  onLabelResize: (deltaPx: number) => void;
  restriction?: AttributeRestriction | null;
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
      {pinnable ? (
        <PinToggle
          pinned={pinned}
          source={source}
          attrKey={attrKey}
          onToggle={onTogglePin}
        />
      ) : (
        // Synthetic leading rows (span_id) aren't real attributes, so they
        // can't be pinned to the trace header — show a disabled, faded pin
        // (matching the PinToggle footprint) instead of a blank gap.
        <DisabledPin attrKey={attrKey} />
      )}
      <Tooltip
        content={attrKey}
        openDelay={250}
        positioning={{ placement: "top-start" }}
      >
        <Text
          width={`${labelWidth}px`}
          flexShrink={0}
          textStyle="xs"
          fontFamily="mono"
          color={pinned ? "fg" : "fg.muted"}
          fontWeight={pinned ? "semibold" : "normal"}
          truncate
          paddingX={3}
          paddingY={1.5}
          bg="bg.subtle"
          transition="color 0.12s ease, font-weight 0.12s ease"
          css={{
            // Strengthen the key column when the row is hovered so the
            // attribute name reads as the focus, not just a tint change.
            ".attr-row:hover &": { color: "fg", fontWeight: "semibold" },
          }}
        >
          {attrKey}
        </Text>
      </Tooltip>
      <LabelResizeHandle onResize={onLabelResize} />
      {/* Pretty-print column. Heuristic format detection picks chat / json
          / text / leaf; non-leaf values render a `📋 format` pill that
          opens a popover with the prettified payload + an override row.
          Same component is wired into table-cell expanders so the same
          payload reads identically wherever it surfaces. */}
      <HStack flex={1} minWidth={0} gap={1.5}>
        {restriction ? <RestrictionMarker {...restriction} /> : null}
        <Box flex={1} minWidth={0}>
          <AttributeValue attrKey={attrKey} value={value} />
        </Box>
      </HStack>
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
  labelWidth,
  onLabelResize,
  leadingKeys,
  restrictionFor,
}: {
  title: string;
  attributes: Record<string, unknown>;
  viewMode: AttrViewMode;
  source: PinnedAttributeSource;
  labelWidth: number;
  onLabelResize: (deltaPx: number) => void;
  /** Keys that always sort first (before pins) and render non-pinnable. */
  leadingKeys?: readonly string[];
  /** Resolves a custom-attribute restrict marker for a row, when one applies. */
  restrictionFor?: (key: string) => AttributeRestriction | null;
}) {
  const { project } = useOrganizationTeamProject();
  const { pins, isPinned, togglePin } = usePinnedAttributes(project?.id);

  const flat = useMemo(() => flattenAttributes(attributes), [attributes]);
  const leading = useMemo(() => new Set(leadingKeys ?? []), [leadingKeys]);
  const pinnedKeys = useMemo(
    () => new Set(pins.filter((p) => p.source === source).map((p) => p.key)),
    [pins, source],
  );
  const sortedEntries = useMemo(
    () =>
      Object.entries(flat).sort(([a], [b]) => {
        const aLead = leading.has(a) ? 0 : 1;
        const bLead = leading.has(b) ? 0 : 1;
        if (aLead !== bLead) return aLead - bLead;
        const aPin = pinnedKeys.has(a) ? 0 : 1;
        const bPin = pinnedKeys.has(b) ? 0 : 1;
        if (aPin !== bPin) return aPin - bPin;
        return a.localeCompare(b);
      }),
    [flat, pinnedKeys, leading],
  );

  if (sortedEntries.length === 0) return null;

  return (
    <Box marginBottom={3}>
      {title && (
        <Text
          textStyle="2xs"
          fontWeight="bold"
          color="fg.muted"
          textTransform="uppercase"
          letterSpacing="0.08em"
          marginBottom={1.5}
        >
          {title}
        </Text>
      )}
      {viewMode === "flat" ? (
        // `position: relative` anchors the absolute-positioned column
        // resize handle inside this card so the line spans the table's
        // full height regardless of how many rows render.
        <Box
          borderRadius="md"
          borderWidth="1px"
          borderColor="border"
          overflow="hidden"
          bg="bg.panel"
        >
          {sortedEntries.map(([key, val], i) => {
            const isLeading = leading.has(key);
            return (
              <FlatRow
                key={key}
                attrKey={key}
                value={val}
                source={source}
                pinned={!isLeading && isPinned(source, key)}
                pinnable={!isLeading}
                isLast={i === sortedEntries.length - 1}
                onTogglePin={() => togglePin({ source, key })}
                labelWidth={labelWidth}
                onLabelResize={onLabelResize}
                restriction={restrictionFor ? restrictionFor(key) : null}
              />
            );
          })}
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
  restrictedAttributes,
  title,
  spanId,
}: AttributeTableProps) {
  const [viewMode, setViewMode] = useState<AttrViewMode>("flat");
  // Compile the viewer's restrict rules once; a row is marked when its flat key
  // matches a rule. Same wildcard matcher the server redaction uses, so the
  // marker lines up with what is actually redacted.
  const restrictionFor = useMemo(() => {
    const compiled = (restrictedAttributes ?? []).map((rule) => ({
      regex: compileAttributePattern(rule.pattern),
      visibleTo: rule.visibleTo,
      canSee: rule.canSee,
    }));
    if (compiled.length === 0) return undefined;
    return (key: string): AttributeRestriction | null => {
      const match = compiled.find((r) => r.regex.test(key));
      return match
        ? { visibleTo: match.visibleTo, canSee: match.canSee }
        : null;
    };
  }, [restrictedAttributes]);
  const [searchTerm, setSearchTerm] = useState("");
  const [labelWidth, , applyLabelDelta] = useLabelColumnWidth();
  const handleLabelResize = applyLabelDelta;

  const flatAttrs = useMemo(() => {
    const flat = flattenAttributes(attributes);
    // Prepend the span id as a synthetic, copyable first row. A real
    // `span_id` attribute (vanishingly unlikely) still wins via the spread.
    return spanId ? { [SPAN_ID_KEY]: spanId, ...flat } : flat;
  }, [attributes, spanId]);
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
        labelWidth={labelWidth}
        onLabelResize={handleLabelResize}
        leadingKeys={spanId ? SPAN_ID_LEADING_KEYS : undefined}
        restrictionFor={restrictionFor}
      />
      {filterResAttrs && (
        <AttrSection
          title="Resource Attributes"
          attributes={filterResAttrs}
          viewMode={viewMode}
          source="resource"
          labelWidth={labelWidth}
          onLabelResize={handleLabelResize}
        />
      )}
    </Box>
  );
}
