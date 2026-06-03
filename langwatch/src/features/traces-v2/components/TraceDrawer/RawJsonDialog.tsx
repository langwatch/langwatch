import {
  Box,
  Button,
  HStack,
  Icon,
  Input,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";
import {
  LuCheck,
  LuCopy,
  LuMinus,
  LuSearch,
  LuWrapText,
  LuX,
} from "react-icons/lu";
import { useColorMode } from "~/components/ui/color-mode";
import { Dialog } from "~/components/ui/dialog";
import { Tooltip } from "~/components/ui/tooltip";
import type { TraceHeader } from "~/server/api/routers/tracesV2.schemas";
import { useSpansFull } from "../../hooks/useSpansFull";
import { ShikiCodeBlock } from "./markdownView";
import { SegmentedToggle } from "./SegmentedToggle";

const COPY_FEEDBACK_MS = 1500;

type RawTab = "trace" | "spans";

interface RawJsonDialogProps {
  open: boolean;
  onClose: () => void;
  trace: TraceHeader;
}

/**
 * Raw JSON inspector. Used by the `\` shortcut to drop into the
 * unprocessed trace + spans payload — escape hatch when something looks
 * off in the rendered surfaces and the user wants to see exactly what
 * the server sent.
 *
 * Operators previously got a single pretty-printed dump in a modal —
 * useful but coarse. This version adds:
 *
 *   - pretty/minify toggle, with byte + line counts so payload size is
 *     visible at a glance (some traces dump 100KB+ of attributes)
 *   - line-wrap toggle for long string values (chat payloads, base64
 *     attachments, full JSON arrays in a single line, …)
 *   - in-payload search that filters to lines containing the query so
 *     finding `metadata.tenant` in a 5K-line payload doesn't require
 *     scrolling
 *   - copy button still copies the *full* payload (search is for
 *     viewing only; users grabbing the JSON for a bug report want
 *     everything)
 */
export function RawJsonDialog({ open, onClose, trace }: RawJsonDialogProps) {
  const [tab, setTab] = useState<RawTab>("trace");
  const [pretty, setPretty] = useState(true);
  const [wrap, setWrap] = useState(true);
  const [search, setSearch] = useState("");
  const { colorMode } = useColorMode();
  const spansQuery = useSpansFull(open);

  // Reset the search field whenever the user switches tabs — searches
  // are tab-scoped and silently carrying a stale query forward led to
  // empty results that looked like "no spans" when the user had just
  // searched in the trace tab.
  useEffect(() => {
    setSearch("");
  }, [tab]);

  const traceJson = useMemo(
    () => JSON.stringify(trace, null, pretty ? 2 : 0),
    [trace, pretty],
  );
  const spansJson = useMemo(
    () =>
      spansQuery.data
        ? JSON.stringify(spansQuery.data, null, pretty ? 2 : 0)
        : null,
    [spansQuery.data, pretty],
  );

  const fullPayload = tab === "trace" ? traceJson : (spansJson ?? "");
  // Filter lines for in-modal search. Case-insensitive substring match
  // — regex felt over-engineered for a 1-line affordance and most users
  // are just looking for an attribute key or a literal value.
  const visiblePayload = useMemo(() => {
    if (!search) return fullPayload;
    const needle = search.toLowerCase();
    return fullPayload
      .split("\n")
      .filter((line) => line.toLowerCase().includes(needle))
      .join("\n");
  }, [fullPayload, search]);

  const byteSize = useMemo(() => fullPayload.length, [fullPayload]);
  const lineCount = useMemo(() => fullPayload.split("\n").length, [fullPayload]);
  const matchedLines = useMemo(
    () =>
      search
        ? visiblePayload === ""
          ? 0
          : visiblePayload.split("\n").length
        : null,
    [visiblePayload, search],
  );

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(e) => {
        if (!e.open) onClose();
      }}
      size="xl"
      placement="center"
    >
      <Dialog.Content
        bg="bg"
        maxHeight="85vh"
        display="flex"
        flexDirection="column"
      >
        <Dialog.Header borderBottomWidth="1px" borderColor="border">
          <VStack align="stretch" gap={2}>
            <HStack gap={3} align="center">
              <Dialog.Title>
                <Text textStyle="md" fontWeight="semibold">
                  Raw JSON
                </Text>
              </Dialog.Title>
              <SegmentedToggle
                value={tab}
                onChange={(t) => setTab(t as RawTab)}
                options={["trace", "spans"]}
              />
              <SizeBadge bytes={byteSize} lines={lineCount} />
              <Box flex={1} />
              <ToggleButton
                active={pretty}
                onClick={() => setPretty((v) => !v)}
                icon={LuMinus}
                tooltip={pretty ? "Minify" : "Pretty-print"}
                label={pretty ? "Pretty" : "Minified"}
              />
              <ToggleButton
                active={wrap}
                onClick={() => setWrap((v) => !v)}
                icon={LuWrapText}
                tooltip={wrap ? "Disable line wrap" : "Wrap long lines"}
                label="Wrap"
              />
              <CopyButton payload={fullPayload} disabled={!fullPayload} />
            </HStack>
            <HStack gap={2} align="center">
              <Box position="relative" flex={1}>
                <Icon
                  as={LuSearch}
                  boxSize={3}
                  position="absolute"
                  left={2}
                  top="50%"
                  transform="translateY(-50%)"
                  color="fg.subtle"
                  pointerEvents="none"
                />
                <Input
                  size="xs"
                  paddingLeft={7}
                  paddingRight={search ? 7 : 2}
                  placeholder="Filter lines (case-insensitive)…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search && (
                  <Box
                    as="button"
                    position="absolute"
                    right={2}
                    top="50%"
                    transform="translateY(-50%)"
                    color="fg.subtle"
                    cursor="pointer"
                    onClick={() => setSearch("")}
                    aria-label="Clear search"
                    _hover={{ color: "fg" }}
                  >
                    <Icon as={LuX} boxSize={3} />
                  </Box>
                )}
              </Box>
              {search && (
                <Text textStyle="2xs" color="fg.muted" whiteSpace="nowrap">
                  {matchedLines ?? 0}/{lineCount} line
                  {lineCount === 1 ? "" : "s"}
                </Text>
              )}
            </HStack>
          </VStack>
          <Dialog.CloseTrigger />
        </Dialog.Header>
        <Dialog.Body
          padding={0}
          overflow="hidden"
          display="flex"
          flexDirection="column"
          flex={1}
        >
          {tab === "spans" && spansQuery.isLoading ? (
            <VStack gap={2} paddingY={8} flex={1} justify="center">
              <Spinner size="sm" color="blue.fg" />
              <Text textStyle="xs" color="fg.muted">
                Loading spans…
              </Text>
            </VStack>
          ) : tab === "spans" && !spansJson ? (
            <VStack gap={2} paddingY={8} flex={1} justify="center">
              <Text textStyle="xs" color="fg.muted">
                Failed to load spans
              </Text>
              <Button
                size="xs"
                variant="outline"
                onClick={() => void spansQuery.refetch()}
              >
                Retry
              </Button>
            </VStack>
          ) : search && visiblePayload === "" ? (
            <VStack gap={2} paddingY={8} flex={1} justify="center">
              <Text textStyle="xs" color="fg.muted">
                No lines match "{search}"
              </Text>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setSearch("")}
              >
                Clear search
              </Button>
            </VStack>
          ) : (
            <Box
              flex={1}
              overflow="auto"
              // Wrap toggle: when on, allow long lines to wrap (good for
              // chat payloads); when off, horizontal scroll preserves
              // the JSON shape (good for diffing nested structures).
              css={
                wrap
                  ? {
                      "& pre, & code": {
                        whiteSpace: "pre-wrap !important",
                        wordBreak: "break-word !important",
                      },
                    }
                  : {
                      "& pre, & code": {
                        whiteSpace: "pre !important",
                      },
                    }
              }
            >
              <ShikiCodeBlock
                code={visiblePayload}
                language="json"
                colorMode={colorMode}
                flush
              />
            </Box>
          )}
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  );
}

function ToggleButton({
  active,
  onClick,
  icon,
  tooltip,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof LuMinus;
  tooltip: string;
  label: string;
}) {
  return (
    <Tooltip content={tooltip} positioning={{ placement: "top" }}>
      <Button
        size="xs"
        variant={active ? "subtle" : "ghost"}
        colorPalette={active ? "blue" : undefined}
        onClick={onClick}
        aria-label={tooltip}
        aria-pressed={active}
        gap={1.5}
      >
        <Icon as={icon} boxSize={3} />
        <Text textStyle="2xs" fontWeight="medium">
          {label}
        </Text>
      </Button>
    </Tooltip>
  );
}

function SizeBadge({ bytes, lines }: { bytes: number; lines: number }) {
  return (
    <Tooltip
      content={`${bytes.toLocaleString()} bytes · ${lines.toLocaleString()} lines`}
      positioning={{ placement: "bottom" }}
    >
      <Text
        textStyle="2xs"
        color="fg.subtle"
        fontFamily="mono"
        whiteSpace="nowrap"
      >
        {formatBytes(bytes)} · {lines}L
      </Text>
    </Tooltip>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function CopyButton({
  payload,
  disabled,
}: {
  payload: string;
  disabled?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const handleClick = () => {
    if (disabled) return;
    void navigator.clipboard.writeText(payload);
    setCopied(true);
    setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
  };
  return (
    <Button
      size="xs"
      variant="ghost"
      onClick={handleClick}
      disabled={disabled}
      aria-label="Copy raw JSON"
      gap={1.5}
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
