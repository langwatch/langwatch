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
import type { AnnotationByTrace } from "~/hooks/useAnnotationsByTraceIds";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { RestrictedAttribute } from "~/server/api/routers/tracesV2.schemas";
import { compileAttributePattern } from "~/server/data-privacy/attributePatternMatcher";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { usePinnedAttributes } from "../../hooks/usePinnedAttributes";
import type { PinnedAttributeSource } from "../../stores/pinnedAttributesStore";
import {
  API_KEY_ATTRIBUTE_LABEL,
  API_KEY_ID_ATTRIBUTE,
  ApiKeyAttributeValue,
} from "./ApiKeyAttribute";
import { AttributeValue } from "./AttributeValue";
import { AnchorCommentButton } from "./anchoredComments/AnchorCommentButton";
import { sameAttributeValue } from "./attributeValueEquality";
import { FormatSelect } from "./FormatSelect";
import { PinnedAwareJsonView } from "./JsonHighlight";

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

/**
 * Turns the span attributes section into an editor. Resource attributes are
 * never editable: they describe the process that emitted the span, not what the
 * span did, so there is nothing about them a reviewer would be correcting.
 */
export interface AttributeEditing {
  /** Per-key overrides on the captured attributes. `null` marks it removed. */
  edits: Record<string, unknown>;
  onEditAttribute: (params: { key: string; value: unknown }) => void;
  /** Drops the override for a key, returning it to what was captured. */
  onResetAttribute: (key: string) => void;
  /**
   * Whether this key can be corrected at all. Absent means every key can,
   * which is the span case; the trace's own metadata carries keys that decide
   * where the trace belongs and are read-only.
   */
  isKeyEditable?: (key: string) => boolean;
}

/**
 * Reads an attribute value out of a text field. Numbers, booleans and JSON keep
 * their shape; anything else stays the string the reviewer typed.
 *
 * A value the trace recorded as text stays text however JSON-shaped it looks.
 * Reading it back as a structure would rewrite what the trace says into
 * something it never carried, and every leaf of that structure would then read
 * as an attribute the correction added.
 */
export function parseAttributeInput({
  text,
  baseline,
}: {
  text: string;
  /** What the trace recorded here, when it recorded anything. */
  baseline?: unknown;
}): unknown {
  if (typeof baseline === "string") return text;
  const trimmed = text.trim();
  if (trimmed.length === 0) return text;
  try {
    return JSON.parse(trimmed);
  } catch {
    return text;
  }
}

/**
 * What a reader can comment on in this table, and what they already said.
 *
 * Only the element's own attributes take comments. Resource attributes describe
 * the process that emitted the span rather than what the span did, which is the
 * same reason a correction never touches them.
 */
export interface AttributeComments {
  traceId: string;
  /** The span the attributes belong to, or the trace id for its own metadata. */
  anchorId: string;
  /** `params` for a span's attributes, `metadata` for the trace's own. */
  pathPrefix: "params" | "metadata";
  /** What was said about one attribute, by the path recorded against it. */
  commentsFor: (anchorPath: string) => AnnotationByTrace[];
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
  /** Present while the reviewer is correcting this span's attributes. */
  editing?: AttributeEditing;
  /**
   * The attributes as captured, when a stored correction replaced them. Rows
   * that differ are marked so a reader can see which values are corrections and
   * hover each one for what the trace originally carried.
   */
  correctedFrom?: Record<string, unknown>;
  /** When set, each of the element's own attribute rows can be commented on. */
  comments?: AttributeComments;
}

/** How one row differs from what was captured. */
interface AttributeCorrection {
  /** The captured value rendered for the tooltip, or null when it is new. */
  original: string | null;
  /**
   * The correction takes this attribute away. The row is still listed, struck
   * through: a row that simply stopped existing reads as one the trace never
   * carried, and the removal is the whole of what the correction did here.
   */
  removed?: boolean;
}

/**
 * How one row differs from what the trace captured, or null when it says the
 * same thing. A key the correction took away is marked removed rather than
 * dropped; one the capture never had at all was added, unless it is a leaf of a
 * value the capture held as one string.
 */
function correctionForKey({
  key,
  capturedFlat,
  correctedFlat,
  removedKeys,
}: {
  key: string;
  capturedFlat: Record<string, unknown>;
  correctedFlat: Record<string, unknown>;
  removedKeys: Record<string, unknown>;
}): AttributeCorrection | null {
  if (key in removedKeys) {
    return { original: formatValue(capturedFlat[key]), removed: true };
  }
  if (key in capturedFlat) {
    return sameAttributeValue(capturedFlat[key], correctedFlat[key])
      ? null
      : { original: formatValue(capturedFlat[key]) };
  }
  const ancestor = capturedAncestorKey({ key, capturedFlat });
  return ancestor === null
    ? { original: null }
    : { original: formatValue(capturedFlat[ancestor]) };
}

/**
 * The captured key one flat key sits underneath, when the capture had one.
 * Walks the dotted path from the longest prefix down, so the nearest captured
 * ancestor wins.
 */
function capturedAncestorKey({
  key,
  capturedFlat,
}: {
  key: string;
  capturedFlat: Record<string, unknown>;
}): string | null {
  let cut = key.lastIndexOf(".");
  while (cut > 0) {
    const prefix = key.slice(0, cut);
    if (prefix in capturedFlat) return prefix;
    cut = key.lastIndexOf(".", cut - 1);
  }
  return null;
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

/**
 * Marks one attribute a correction replaced or added, with the captured value
 * in the tooltip. An attribute value is a scalar, so the whole of it fits
 * there and the reader never has to open anything to compare.
 */
function CorrectionMarker({
  attrKey,
  original,
  removed,
}: {
  attrKey: string;
  original: string | null;
  removed?: boolean;
}) {
  if (removed) {
    return (
      <Tooltip content="Removed by an edit" positioning={{ placement: "top" }}>
        <Text
          as="span"
          textStyle="2xs"
          fontWeight="semibold"
          color="red.fg"
          bg="red.subtle"
          borderWidth="1px"
          borderColor="red.muted"
          borderRadius="sm"
          paddingX={1.5}
          flexShrink={0}
          cursor="help"
          aria-label={`${attrKey}, removed by an edit`}
        >
          Removed
        </Text>
      </Tooltip>
    );
  }
  const label =
    original === null
      ? `${attrKey}, added by an edit`
      : `${attrKey}, edited. Original: ${original}`;
  return (
    <Tooltip
      content={original === null ? "Added by an edit" : `Original: ${original}`}
      positioning={{ placement: "top" }}
    >
      <Text
        as="span"
        textStyle="2xs"
        fontWeight="semibold"
        color="green.fg"
        bg="green.subtle"
        borderWidth="1px"
        borderColor="green.muted"
        borderRadius="sm"
        paddingX={1.5}
        flexShrink={0}
        cursor="help"
        aria-label={label}
      >
        Edited
      </Text>
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

/**
 * Per-key seam for the handful of attributes whose raw key/value pair reads as
 * plumbing. A special-cased key can trim its label here and swap the generic
 * `AttributeValue` cell for one that resolves the stored value into something
 * an operator can act on; everything else falls through untouched.
 */
function attributeRowLabel(attrKey: string): string {
  return attrKey === API_KEY_ID_ATTRIBUTE ? API_KEY_ATTRIBUTE_LABEL : attrKey;
}

function isApiKeyIdRow(attrKey: string, value: unknown): value is string {
  return (
    attrKey === API_KEY_ID_ATTRIBUTE && typeof value === "string" && !!value
  );
}

/** How one row behaves while the reviewer is correcting the span. */
interface RowEditing {
  /** True when the correction removes this key. */
  isRemoved: boolean;
  /** True when the correction replaces this key's value. */
  isChanged: boolean;
  /** What the trace recorded here, so an edit keeps the shape it had. */
  baseline: unknown;
  onChangeValue: (value: unknown) => void;
  onRemove: () => void;
  onRestore: () => void;
}

/**
 * The value cell while editing: a text field for the value, plus remove and
 * restore. A removed key stays on screen struck through rather than vanishing,
 * so the reviewer can see (and undo) what the correction takes away.
 */
function EditableValueCell({
  attrKey,
  value,
  editing,
}: {
  attrKey: string;
  value: unknown;
  editing: RowEditing;
}) {
  const display = formatValue(value);
  // `formatValue` is the read-only renderer and answers an em dash for an
  // empty value, which must never become text the reviewer is editing.
  const editorText =
    value === undefined || value === null
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);

  if (editing.isRemoved) {
    return (
      <HStack flex={1} minWidth={0} gap={2} paddingY={1}>
        <Text
          flex={1}
          minWidth={0}
          textStyle="xs"
          fontFamily="mono"
          color="fg.subtle"
          textDecoration="line-through"
          truncate
        >
          {display}
        </Text>
        <Button
          size="xs"
          variant="ghost"
          onClick={editing.onRestore}
          aria-label={`Restore ${attrKey}`}
        >
          <Text textStyle="2xs">Restore</Text>
        </Button>
      </HStack>
    );
  }

  return (
    <HStack flex={1} minWidth={0} gap={2} paddingY={1}>
      <Input
        size="xs"
        aria-label={`Edit ${attrKey}`}
        value={editorText}
        onChange={(e) =>
          editing.onChangeValue(
            parseAttributeInput({
              text: e.target.value,
              baseline: editing.baseline,
            }),
          )
        }
        fontFamily="mono"
        bg={editing.isChanged ? "green.subtle" : undefined}
        borderColor={editing.isChanged ? "green.muted" : "border.muted"}
      />
      <Button
        size="xs"
        variant="ghost"
        onClick={editing.onRemove}
        aria-label={`Remove ${attrKey}`}
      >
        <Text textStyle="2xs">Remove</Text>
      </Button>
    </HStack>
  );
}

/** A corrected row is tinted and ticked; a pinned one is only tinted. */
function rowHighlight({
  isCorrected,
  isPinned,
}: {
  isCorrected: boolean;
  isPinned: boolean;
}): { bg?: string; boxShadow?: string } {
  if (isCorrected) {
    return {
      bg: "green.subtle",
      boxShadow: "inset 2px 0 0 var(--chakra-colors-green-solid)",
    };
  }
  if (isPinned) return { bg: "bg.subtle" };
  return {};
}

function RowLabelCell({
  attrKey,
  labelWidth,
  isPinned,
  isRemoved,
}: {
  attrKey: string;
  labelWidth: number;
  isPinned: boolean;
  /** The correction removes this attribute, so the name is struck through. */
  isRemoved: boolean;
}) {
  return (
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
        color={isPinned ? "fg" : "fg.muted"}
        fontWeight={isPinned ? "semibold" : "normal"}
        textDecoration={isRemoved ? "line-through" : undefined}
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
        {attributeRowLabel(attrKey)}
      </Text>
    </Tooltip>
  );
}

/**
 * The value column: what is restricted or corrected about this attribute, and
 * then the value itself, editable or read-only.
 *
 * Pretty-print column. Heuristic format detection picks chat / json / text /
 * leaf; non-leaf values render a `📋 format` pill that opens a popover with the
 * prettified payload + an override row. The same component is wired into
 * table-cell expanders so the same payload reads identically wherever it
 * surfaces.
 */
function RowValueCell({
  attrKey,
  value,
  restriction,
  correction,
  editing,
}: {
  attrKey: string;
  value: unknown;
  restriction?: AttributeRestriction | null;
  correction?: AttributeCorrection | null;
  /** Present only when this row is editable. */
  editing?: RowEditing;
}) {
  return (
    <HStack flex={1} minWidth={0} gap={1.5}>
      {restriction ? <RestrictionMarker {...restriction} /> : null}
      {correction ? (
        <CorrectionMarker
          attrKey={attrKey}
          original={correction.original}
          removed={correction.removed}
        />
      ) : null}
      {editing ? (
        <EditableValueCell attrKey={attrKey} value={value} editing={editing} />
      ) : (
        <Box
          flex={1}
          minWidth={0}
          textDecoration={correction?.removed ? "line-through" : undefined}
          color={correction?.removed ? "fg.subtle" : undefined}
        >
          {isApiKeyIdRow(attrKey, value) ? (
            <ApiKeyAttributeValue apiKeyId={value} />
          ) : (
            <AttributeValue attrKey={attrKey} value={value} />
          )}
        </Box>
      )}
    </HStack>
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
  editing,
  correction,
  comments,
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
  editing?: RowEditing;
  correction?: AttributeCorrection | null;
  /** Present when this row can be commented on. */
  comments?: AttributeComments;
}) {
  const display = formatValue(value);
  // A value already hidden from this viewer has nothing on screen to correct,
  // so it keeps its read-only cell.
  const rowEditing = restriction?.canSee === false ? undefined : editing;
  // A value the reader is not allowed to read is not something they can say
  // anything about, and a row open for correction has the reviewer's attention
  // on what it should say instead. Both drop the comment action, the way the
  // row's copy action already drops out while it is being edited.
  const anchorPath = `${comments?.pathPrefix}.${attrKey}`;
  const rowComments =
    comments && !rowEditing && restriction?.canSee !== false ? comments : null;
  return (
    <HStack
      borderBottomWidth={isLast ? "0px" : "1px"}
      borderColor="border.muted"
      _hover={{ bg: "bg.muted" }}
      gap={0}
      paddingRight={2}
      className="attr-row"
      {...rowHighlight({ isCorrected: !!correction, isPinned: pinned })}
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
      <RowLabelCell
        attrKey={attrKey}
        labelWidth={labelWidth}
        isPinned={pinned}
        isRemoved={editing?.isRemoved === true}
      />
      <LabelResizeHandle onResize={onLabelResize} />
      <RowValueCell
        attrKey={attrKey}
        value={value}
        restriction={restriction}
        correction={correction}
        editing={rowEditing}
      />
      {rowComments && (
        <AnchorCommentButton
          traceId={rowComments.traceId}
          anchor={{
            anchorKind: "field",
            anchorId: rowComments.anchorId,
            anchorPath,
          }}
          comments={rowComments.commentsFor(anchorPath)}
          name={attrKey}
          dense
          reveal="on-row-hover"
        />
      )}
      {!rowEditing && (
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
      )}
    </HStack>
  );
}

/**
 * What one row offers a reviewer who is correcting the attributes. A synthetic
 * leading row (span_id) is not a real attribute, so it stays read-only.
 */
function rowEditingFor({
  editing,
  key,
  isLeading,
  baseline,
}: {
  editing?: AttributeEditing;
  key: string;
  isLeading: boolean;
  baseline: unknown;
}): RowEditing | undefined {
  if (!editing || isLeading) return undefined;
  if (editing.isKeyEditable?.(key) === false) return undefined;
  return {
    isRemoved: editing.edits[key] === null,
    isChanged: key in editing.edits && editing.edits[key] !== null,
    baseline,
    onChangeValue: (value) => editing.onEditAttribute({ key, value }),
    onRemove: () => editing.onEditAttribute({ key, value: null }),
    onRestore: () => editing.onResetAttribute(key),
  };
}

/**
 * What one row shows on top of its value: whether the viewer's restrict rules
 * cover it, what a stored correction replaced there, and what it offers a
 * reviewer who is correcting the span. Each comes from a resolver the section
 * may not have been given, in which case the row carries none of that marker.
 */
function rowMarkersFor({
  key,
  isLeading,
  restrictionFor,
  correctionFor,
  baselineFor,
  editing,
}: {
  key: string;
  isLeading: boolean;
  restrictionFor?: (key: string) => AttributeRestriction | null;
  correctionFor?: (key: string) => AttributeCorrection | null;
  baselineFor?: (key: string) => unknown;
  editing?: AttributeEditing;
}): {
  restriction: AttributeRestriction | null;
  correction: AttributeCorrection | null;
  editing: RowEditing | undefined;
} {
  return {
    restriction: restrictionFor ? restrictionFor(key) : null,
    correction: correctionFor && !isLeading ? correctionFor(key) : null,
    editing: rowEditingFor({
      editing,
      key,
      isLeading,
      baseline: baselineFor ? baselineFor(key) : undefined,
    }),
  };
}

function AttrSection({
  title,
  attributes,
  jsonAttributes,
  viewMode,
  source,
  labelWidth,
  onLabelResize,
  leadingKeys,
  restrictionFor,
  editing,
  allKeys,
  correctionFor,
  baselineFor,
  comments,
}: {
  title: string;
  attributes: Record<string, unknown>;
  /**
   * What the JSON view quotes, when that is not the rows listed. A removal is a
   * row the flat view strikes through; JSON has nowhere to draw that, so it
   * quotes the attributes as the correction left them.
   */
  jsonAttributes?: Record<string, unknown>;
  viewMode: AttrViewMode;
  source: PinnedAttributeSource;
  labelWidth: number;
  onLabelResize: (deltaPx: number) => void;
  /** Keys that always sort first (before pins) and render non-pinnable. */
  leadingKeys?: readonly string[];
  /** Resolves a custom-attribute restrict marker for a row, when one applies. */
  restrictionFor?: (key: string) => AttributeRestriction | null;
  /** Present while this section's attributes are being corrected. */
  editing?: AttributeEditing;
  /**
   * Every key the span carries, not only the rows the filter left on screen. A
   * new attribute has to be checked against all of them: a key hidden by the
   * filter still collides, and the correction would quietly overwrite it.
   */
  allKeys?: Set<string>;
  /** Resolves the captured value a stored correction replaced, when it did. */
  correctionFor?: (key: string) => AttributeCorrection | null;
  /** Resolves what the trace recorded at a key, before this session's edits. */
  baselineFor?: (key: string) => unknown;
  /** When set, each row of this section offers to be commented on. */
  comments?: AttributeComments;
}) {
  const { project } = useOrganizationTeamProject();
  const { pins, isPinned, togglePin } = usePinnedAttributes(project?.id);

  const flat = useMemo(() => flattenAttributes(attributes), [attributes]);
  const jsonFlat = useMemo(
    () => (jsonAttributes ? flattenAttributes(jsonAttributes) : flat),
    [jsonAttributes, flat],
  );
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

  if (sortedEntries.length === 0 && !editing) return null;

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
                comments={isLeading ? undefined : comments}
                {...rowMarkersFor({
                  key,
                  isLeading,
                  restrictionFor,
                  correctionFor,
                  baselineFor,
                  editing,
                })}
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
            content={JSON.stringify(buildNestedObject(jsonFlat), null, 2)}
            pinnedKeys={pinnedKeys}
          />
        </Box>
      )}
      {editing && (
        <AddAttributeRow
          existingKeys={allKeys ?? new Set(Object.keys(flat))}
          {...editing}
        />
      )}
    </Box>
  );
}

/**
 * The attribute a new key would collide with in the nested tree, if any.
 *
 * Keys are dotted paths, so `gen_ai.operation` and `gen_ai.operation.name`
 * cannot both hold a value: one is a branch of the other, and rebuilding the
 * tree keeps whichever came last. Exact duplicates are caught before this.
 */
function findNestedKeyConflict({
  key,
  existingKeys,
}: {
  key: string;
  existingKeys: Set<string>;
}): string | undefined {
  for (const existingKey of existingKeys) {
    if (
      existingKey.startsWith(`${key}.`) ||
      key.startsWith(`${existingKey}.`)
    ) {
      return existingKey;
    }
  }
  return undefined;
}

/**
 * Adds an attribute the trace never recorded. The key check is here rather
 * than on save because a duplicate key would silently overwrite the row above
 * it, and the reviewer would only find out by reading the saved correction.
 */
function AddAttributeRow({
  existingKeys,
  onEditAttribute,
  isKeyEditable,
}: AttributeEditing & { existingKeys: Set<string> }) {
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleAdd = () => {
    const trimmedKey = key.trim();
    if (trimmedKey.length === 0) return;
    if (existingKeys.has(trimmedKey)) {
      setError("This key already exists");
      return;
    }
    const nested = findNestedKeyConflict({ key: trimmedKey, existingKeys });
    if (nested) {
      setError(`This key conflicts with ${nested}`);
      return;
    }
    if (isKeyEditable?.(trimmedKey) === false) {
      setError("This key can't be edited");
      return;
    }
    onEditAttribute({
      key: trimmedKey,
      value: parseAttributeInput({ text: value }),
    });
    setKey("");
    setValue("");
    setError(null);
  };

  return (
    <Box marginTop={2}>
      <HStack gap={2} align="center">
        <Input
          size="xs"
          aria-label="New attribute name"
          placeholder="Attribute name"
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
            setError(null);
          }}
          fontFamily="mono"
          width="220px"
          flexShrink={0}
        />
        <Input
          size="xs"
          aria-label="New attribute value"
          placeholder="Value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          fontFamily="mono"
          flex={1}
        />
        <Button size="xs" variant="outline" onClick={handleAdd}>
          Add attribute
        </Button>
      </HStack>
      {error && (
        <Text textStyle="2xs" color="red.fg" marginTop={1}>
          {error}
        </Text>
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
  editing,
  correctedFrom,
  comments,
}: AttributeTableProps) {
  const [viewMode, setViewMode] = useState<AttrViewMode>("flat");
  // The JSON view is a read-only rendering of the same rows, so while the
  // attributes are being corrected the table stays on the editable one.
  const effectiveViewMode: AttrViewMode = editing ? "flat" : viewMode;
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

  // What the rows read before this session touched them, which is what an edit
  // is measured against and what keeps an edited value in the shape the trace
  // recorded it in.
  const baselineFlat = useMemo(
    () => flattenAttributes(attributes),
    [attributes],
  );
  const baselineFor = useCallback(
    (key: string) => baselineFlat[key],
    [baselineFlat],
  );

  // Keys the capture had that the correction does not. They keep their captured
  // value so the struck-through row still shows what is being taken away.
  const removedKeys = useMemo(() => {
    if (!correctedFrom) return {};
    const corrected = flattenAttributes(attributes);
    const captured = flattenAttributes(correctedFrom);
    return Object.fromEntries(
      Object.entries(captured).filter(([key]) => !(key in corrected)),
    );
  }, [attributes, correctedFrom]);

  // What the span carries once the correction is applied, which is what copying
  // and the JSON view quote: an attribute the correction took away must not
  // travel back out as one the span still has.
  const correctedFlat = useMemo(() => {
    const flat = flattenAttributes(attributes);
    // Attributes the correction adds are rows in their own right.
    for (const [key, value] of Object.entries(editing?.edits ?? {})) {
      if (value === null) continue;
      flat[key] = value;
    }
    // Prepend the span id as a synthetic, copyable first row. A real
    // `span_id` attribute (vanishingly unlikely) still wins via the spread.
    return spanId ? { [SPAN_ID_KEY]: spanId, ...flat } : flat;
  }, [attributes, spanId, editing?.edits]);

  // The rows the table lists: everything the corrected span carries, plus the
  // keys it took away. Those keep their captured value so the struck-through
  // row still shows what is being taken away, and a correction that re-adds one
  // under a different value still reads as that value. Rows sort by key, so
  // where a row goes in makes no difference to where it lands.
  const flatAttrs = useMemo(() => {
    const removedRows = Object.entries(removedKeys).filter(
      ([key]) => !(key in correctedFlat),
    );
    if (removedRows.length === 0) return correctedFlat;
    return { ...correctedFlat, ...Object.fromEntries(removedRows) };
  }, [correctedFlat, removedKeys]);
  const flatResAttrs = useMemo(
    () =>
      resourceAttributes ? flattenAttributes(resourceAttributes) : undefined,
    [resourceAttributes],
  );

  // A row is marked when the correction gave it a different value than the one
  // captured, or added it outright. The comparison is per row: a correction may
  // replace a whole attribute record and leave most of it saying exactly what it
  // said. It compares what the values mean rather than how they are written, so
  // a row that came back re-serialised does not read as one someone edited.
  const correctionFor = useMemo(() => {
    if (!correctedFrom) return undefined;
    const capturedFlat = flattenAttributes(correctedFrom);
    return (key: string): AttributeCorrection | null =>
      correctionForKey({
        key,
        capturedFlat,
        correctedFlat: flatAttrs,
        removedKeys,
      });
  }, [correctedFrom, flatAttrs, removedKeys]);

  const filterAttrs = useMemo(
    () => filterAttributesBySearch(flatAttrs, searchTerm),
    [flatAttrs, searchTerm],
  );
  const filterCorrectedAttrs = useMemo(
    () =>
      flatAttrs === correctedFlat
        ? filterAttrs
        : filterAttributesBySearch(correctedFlat, searchTerm),
    [flatAttrs, correctedFlat, filterAttrs, searchTerm],
  );
  const allAttributeKeys = useMemo(
    () => new Set(Object.keys(flatAttrs)),
    [flatAttrs],
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
      ...buildNestedObject(filterCorrectedAttrs),
    };
    if (filterResAttrs) {
      root.resource = buildNestedObject(filterResAttrs);
    }
    return JSON.stringify(root, null, 2);
  }, [filterCorrectedAttrs, filterResAttrs]);

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
        {!editing && (
          <FormatSelect
            value={viewMode}
            onChange={setViewMode}
            options={VIEW_MODE_OPTIONS}
            ariaLabel="Attributes view format"
          />
        )}
        <CopyAllButton payload={copyPayload} />
      </HStack>

      <AttrSection
        title={spanAttrTitle}
        attributes={filterAttrs}
        jsonAttributes={filterCorrectedAttrs}
        viewMode={effectiveViewMode}
        source="attribute"
        labelWidth={labelWidth}
        onLabelResize={handleLabelResize}
        leadingKeys={spanId ? SPAN_ID_LEADING_KEYS : undefined}
        restrictionFor={restrictionFor}
        editing={editing}
        allKeys={allAttributeKeys}
        correctionFor={correctionFor}
        baselineFor={baselineFor}
        comments={comments}
      />
      {filterResAttrs && (
        <AttrSection
          title="Resource Attributes"
          attributes={filterResAttrs}
          viewMode={effectiveViewMode}
          source="resource"
          labelWidth={labelWidth}
          onLabelResize={handleLabelResize}
        />
      )}
    </Box>
  );
}
