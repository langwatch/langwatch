import {
  Box,
  Button,
  Circle,
  HStack,
  Icon,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  LuArrowLeft,
  LuCopy,
  LuExternalLink,
  LuKeyboard,
  LuMaximize2,
  LuMinimize2,
  LuShare2,
} from "react-icons/lu";
import { Link } from "~/components/ui/link";
import { Tooltip } from "~/components/ui/tooltip";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useDejaViewLink } from "~/hooks/useDejaViewLink";
import type { TraceHeader } from "~/server/api/routers/tracesV2.schemas";
import type { DrawerViewMode } from "../../stores/drawerStore";
import {
  abbreviateModel,
  formatCost,
  formatDuration,
  formatRelativeTime,
  formatTokens,
  SPAN_TYPE_COLORS,
  STATUS_COLORS,
} from "../../utils/formatters";
import { Kbd } from "~/components/ops/shared/Kbd";
import { ModeSwitch } from "./ModeSwitch";

interface DrawerHeaderProps {
  trace: TraceHeader;
  isMaximized: boolean;
  viewMode: DrawerViewMode;
  onViewModeChange: (mode: DrawerViewMode) => void;
  onToggleMaximized: () => void;
  onClose: () => void;
  onShowShortcuts: () => void;
  canGoBack: boolean;
  onGoBack: () => void;
  backStackDepth: number;
}

function readNumberAttribute(
  attributes: Record<string, string>,
  ...keys: string[]
): number | null {
  for (const key of keys) {
    const raw = attributes[key];
    if (raw == null) continue;
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function DrawerHeader({
  trace,
  isMaximized,
  viewMode,
  onViewModeChange,
  onToggleMaximized,
  onClose,
  onShowShortcuts,
  canGoBack,
  onGoBack,
  backStackDepth,
}: DrawerHeaderProps) {
  const statusColor = STATUS_COLORS[trace.status] as string;
  const { project } = useOrganizationTeamProject();
  const dejaView = useDejaViewLink({
    aggregateId: trace.traceId,
    tenantId: project?.id,
  });

  const cacheReadTokens = readNumberAttribute(
    trace.attributes,
    "gen_ai.usage.cache_read.input_tokens",
    "gen_ai.usage.cached_tokens",
  );
  const cacheCreationTokens = readNumberAttribute(
    trace.attributes,
    "gen_ai.usage.cache_creation.input_tokens",
  );

  // If we have concrete input AND output token numbers to display, trust them
  // and suppress the "estimated" caveat — historical trace summaries can carry
  // a stale `tokensEstimated=true` from before the per-span fix landed, so
  // gating on actual presence here keeps the popover honest without a backfill.
  const hasAuthoritativeTokens =
    trace.inputTokens != null &&
    trace.outputTokens != null &&
    (trace.inputTokens > 0 || trace.outputTokens > 0);

  const sdkName = trace.attributes["sdk.name"];
  const sdkVersion = trace.attributes["sdk.version"];
  const sdkLanguage = trace.attributes["sdk.language"];
  const sdkChip = sdkName
    ? {
        name: sdkName,
        version: sdkVersion,
        language: sdkLanguage,
        label: sdkVersion ? `${sdkName} ${sdkVersion}` : sdkName,
      }
    : null;

  const handleCopyTraceId = () => {
    void navigator.clipboard.writeText(trace.traceId);
  };

  return (
    <VStack align="stretch" gap={2} paddingX={4} paddingY={3}>
      {/* Row 1: Trace ID + Actions */}
      <HStack justify="space-between" align="center">
        <HStack gap={1} minWidth={0}>
          {canGoBack && (
            <Tooltip
              content={
                backStackDepth > 1
                  ? `Back (${backStackDepth} traces)`
                  : "Back to previous trace"
              }
              positioning={{ placement: "bottom" }}
            >
              <Button
                size="xs"
                variant="ghost"
                onClick={onGoBack}
                aria-label="Back to previous trace"
                flexShrink={0}
              >
                <Icon as={LuArrowLeft} boxSize={3.5} />
              </Button>
            </Tooltip>
          )}
          <Text textStyle="xs" color="fg.subtle" fontFamily="mono" cursor="default" truncate>
            trace: {trace.traceId}
          </Text>
          <Button
            size="xs"
            variant="ghost"
            onClick={handleCopyTraceId}
            aria-label="Copy trace ID"
            padding={0}
            minWidth="auto"
            height="auto"
            flexShrink={0}
          >
            <Icon as={LuCopy} boxSize={3} color="fg.subtle" />
          </Button>
        </HStack>

        <HStack gap={1} flexShrink={0}>
          <Tooltip
            content="Sharing is coming soon"
            positioning={{ placement: "bottom" }}
          >
            <Button
              size="xs"
              variant="ghost"
              disabled
              aria-label="Share trace"
            >
              <Icon as={LuShare2} boxSize={3.5} />
            </Button>
          </Tooltip>
          {dejaView.href && (
            <Tooltip
              content="Open in DejaView"
              positioning={{ placement: "bottom" }}
            >
              <Link href={dejaView.href} isExternal aria-label="Open in DejaView">
                <Button size="xs" variant="ghost">
                  <Icon as={LuExternalLink} boxSize={3.5} />
                </Button>
              </Link>
            </Tooltip>
          )}
          <Tooltip
            content={
              <HStack gap={1}>
                <Text>Keyboard shortcuts</Text>
                <Kbd>?</Kbd>
              </HStack>
            }
            positioning={{ placement: "bottom" }}
          >
            <Button
              size="xs"
              variant="ghost"
              onClick={onShowShortcuts}
              aria-label="Show keyboard shortcuts"
            >
              <Icon as={LuKeyboard} boxSize={3.5} />
            </Button>
          </Tooltip>
          <Tooltip
            content={
              <HStack gap={1}>
                <Text>{isMaximized ? "Restore" : "Maximize"}</Text>
                <Kbd>M</Kbd>
              </HStack>
            }
            positioning={{ placement: "bottom" }}
          >
            <Button
              size="xs"
              variant="ghost"
              onClick={onToggleMaximized}
              aria-label={isMaximized ? "Restore drawer" : "Maximize drawer"}
            >
              <Icon
                as={isMaximized ? LuMinimize2 : LuMaximize2}
                boxSize={3.5}
              />
            </Button>
          </Tooltip>
          <Tooltip
            content={
              <HStack gap={1}>
                <Text>Close</Text>
                <Kbd>Esc</Kbd>
              </HStack>
            }
            positioning={{ placement: "bottom" }}
          >
            <Button
              size="xs"
              variant="ghost"
              onClick={onClose}
              aria-label="Close drawer"
            >
              x
            </Button>
          </Tooltip>
        </HStack>
      </HStack>

      {/* Row 2: Root span name + type badge + status */}
      <HStack gap={2} minWidth={0} flexWrap="wrap">
        {trace.rootSpanType && (
          <Text
            textStyle="2xs"
            fontWeight="semibold"
            color={
              (SPAN_TYPE_COLORS[trace.rootSpanType] as string) ?? "gray.solid"
            }
            paddingX={1.5}
            borderRadius="sm"
            borderWidth="1px"
            borderColor={
              (SPAN_TYPE_COLORS[trace.rootSpanType] as string) ?? "gray.solid"
            }
            flexShrink={0}
          >
            {trace.rootSpanType.toUpperCase()}
          </Text>
        )}
        <Text fontWeight="semibold" textStyle="sm" truncate fontFamily="mono">
          {trace.rootSpanName ?? trace.name}
        </Text>
        <HStack gap={1}>
          <Circle size="8px" bg={statusColor} flexShrink={0} />
          {trace.status !== "ok" && (
            <Text
              textStyle="xs"
              color={statusColor}
              textTransform="capitalize"
            >
              {trace.status}
            </Text>
          )}
        </HStack>
      </HStack>

      {/* Row 3: Metric pills */}
      <HStack gap={1.5} flexWrap="wrap">
        <MetricPill label="Duration" value={formatDuration(trace.durationMs)} />
        {trace.ttft != null && (
          <Tooltip
            content={`Time to First Token: ${formatDuration(trace.ttft)}`}
            positioning={{ placement: "top" }}
          >
            <Box>
              <MetricPill label="TTFT" value={formatDuration(trace.ttft)} />
            </Box>
          </Tooltip>
        )}
        {(trace.totalCost ?? 0) > 0 && (
          <Tooltip
            content={
              <VStack align="stretch" gap={0.5} minWidth="140px">
                <TooltipRow
                  label="Total"
                  value={formatCost(trace.totalCost ?? 0, trace.tokensEstimated)}
                />
                {trace.tokensEstimated && !hasAuthoritativeTokens && (
                  <Text textStyle="2xs" color="fg.muted" paddingTop={1}>
                    Cost is estimated from token counts
                  </Text>
                )}
              </VStack>
            }
            positioning={{ placement: "top" }}
          >
            <Box>
              <MetricPill label="Cost" value={formatCost(trace.totalCost ?? 0)} />
            </Box>
          </Tooltip>
        )}
        {trace.totalTokens > 0 && (
          <Tooltip
            content={
              <VStack align="stretch" gap={0.5} minWidth="180px">
                <TooltipRow
                  label="Input"
                  value={trace.inputTokens?.toLocaleString() ?? "—"}
                />
                <TooltipRow
                  label="Output"
                  value={trace.outputTokens?.toLocaleString() ?? "—"}
                />
                {cacheReadTokens != null && (
                  <TooltipRow
                    label="Cache read"
                    value={cacheReadTokens.toLocaleString()}
                  />
                )}
                {cacheCreationTokens != null && (
                  <TooltipRow
                    label="Cache write"
                    value={cacheCreationTokens.toLocaleString()}
                  />
                )}
                <Box height="1px" bg="border" marginY={1} />
                <TooltipRow
                  label="Total"
                  value={trace.totalTokens.toLocaleString()}
                />
                {trace.tokensEstimated && !hasAuthoritativeTokens && (
                  <Text textStyle="2xs" color="fg.muted" paddingTop={1}>
                    Tokens are estimated
                  </Text>
                )}
              </VStack>
            }
            positioning={{ placement: "top" }}
          >
            <Box>
              <MetricPill
                label="Tokens"
                value={
                  trace.inputTokens != null && trace.outputTokens != null
                    ? `${formatTokens(trace.inputTokens)} in · ${formatTokens(trace.outputTokens)} out`
                    : trace.totalTokens.toLocaleString()
                }
              />
            </Box>
          </Tooltip>
        )}
        {trace.models.length > 0 && (
          <MetricPill
            label="Model"
            value={abbreviateModel(trace.models[0]!)}
          />
        )}
      </HStack>

      {/* Row 4: Context tags */}
      <HStack gap={2} flexWrap="wrap">
        {trace.serviceName && (
          <ContextChip>{trace.serviceName}</ContextChip>
        )}
        <ContextChip>{trace.origin}</ContextChip>
        {sdkChip && (
          <Tooltip
            content={
              <VStack align="stretch" gap={0.5} minWidth="160px">
                {sdkChip.name && (
                  <TooltipRow label="SDK" value={sdkChip.name} />
                )}
                {sdkChip.version && (
                  <TooltipRow label="Version" value={sdkChip.version} />
                )}
                {sdkChip.language && (
                  <TooltipRow label="Language" value={sdkChip.language} />
                )}
              </VStack>
            }
            positioning={{ placement: "top" }}
          >
            <Box>
              <ContextChip>{sdkChip.label}</ContextChip>
            </Box>
          </Tooltip>
        )}
        <Text textStyle="xs" color="fg.subtle" marginLeft="auto">
          {formatRelativeTime(trace.timestamp)}
        </Text>
      </HStack>

      {/* Row 5: View mode toggle (only when this trace belongs to a conversation) */}
      {trace.conversationId && (
        <Box marginX={-4}>
          <ModeSwitch
            viewMode={viewMode}
            onViewModeChange={onViewModeChange}
            hasConversation={!!trace.conversationId}
          />
        </Box>
      )}
    </VStack>
  );
}

function ContextChip({ children }: { children: React.ReactNode }) {
  return (
    <Text
      textStyle="xs"
      color="fg.muted"
      paddingX={1.5}
      paddingY={0.5}
      borderRadius="sm"
      bg="bg.muted"
    >
      {children}
    </Text>
  );
}

function TooltipRow({ label, value }: { label: string; value: string }) {
  return (
    <HStack justify="space-between" gap={4}>
      <Text textStyle="xs" color="fg.muted">
        {label}
      </Text>
      <Text textStyle="xs" fontFamily="mono" color="fg">
        {value}
      </Text>
    </HStack>
  );
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <HStack
      gap={1.5}
      paddingX={2.5}
      paddingY={0.5}
      borderRadius="full"
      borderWidth="1px"
      borderColor="border.muted"
      bg="bg.subtle"
    >
      <Text
        textStyle="2xs"
        color="fg.subtle"
        fontFamily="mono"
        textTransform="uppercase"
        letterSpacing="0.04em"
        fontWeight="medium"
      >
        {label}
      </Text>
      <Text textStyle="xs" color="fg" fontFamily="mono" fontWeight="medium">
        {value}
      </Text>
    </HStack>
  );
}
