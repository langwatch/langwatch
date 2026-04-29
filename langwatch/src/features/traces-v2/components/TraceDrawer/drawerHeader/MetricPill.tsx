import { Box, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { useCallback, useState } from "react";
import {
  LuArrowUpRight,
  LuCheck,
  LuCopy,
  LuFilter,
  LuPin,
  LuSparkles,
} from "react-icons/lu";
import { Tooltip } from "~/components/ui/tooltip";
import type { PinnedAttribute } from "../../../stores/pinnedAttributesStore";
import { TooltipRow } from "./TooltipRow";

export function MetricPill({ label, value }: { label: string; value: string }) {
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

/**
 * MetricPill-shaped pill for a pinned (or auto-pinned) attribute. Sits
 * inline with Duration/Cost/Tokens so the user sees their pinned attrs
 * exactly where they expect scannable data — not as a separate strip up
 * top.
 */
export function PinnedMetricPill({
  pin,
  value,
  auto,
  onUnpin,
  onFilter,
  onNavigate,
  navigateLabel,
}: {
  pin: PinnedAttribute;
  value: string | null;
  auto: boolean;
  onUnpin: (source: PinnedAttribute["source"], key: string) => void;
  /** When provided, the pill grows a filter button that scopes the trace
   * table to this attribute's value. Used for user / conversation / thread
   * pills where filtering is a primary affordance. */
  onFilter?: () => void;
  /** When provided, the pill grows a "jump" arrow that navigates to the
   * related thing (conversation view, scenario run drawer, prompts tab,
   * …). Tooltip uses `navigateLabel` if set, else "Open". */
  onNavigate?: () => void;
  navigateLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  const display = value ?? "—";
  const label = pin.label ?? pin.key;

  const handleCopy = useCallback(() => {
    if (value == null) return;
    void navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }, [value]);

  const tooltipBody = (
    <VStack align="stretch" gap={0.5} minWidth="180px" maxWidth="320px">
      <TooltipRow
        label={
          auto
            ? "Auto-pinned"
            : pin.source === "resource"
              ? "Resource"
              : "Attribute"
        }
        value={pin.key}
      />
      <TooltipRow label="Value" value={display} />
      <Text textStyle="2xs" color="fg.muted" paddingTop={1}>
        Click value to copy
        {onNavigate
          ? ` · click arrow to ${navigateLabel?.toLowerCase() ?? "open"}`
          : ""}
        {onFilter ? " · click filter to scope the table" : ""}
        {auto ? "" : " · click pin to unpin"}
      </Text>
    </VStack>
  );

  const fg = auto ? "purple.fg" : "blue.fg";
  const bg = auto ? "purple.solid/8" : "blue.solid/8";
  const border = auto ? "purple.solid/30" : "blue.solid/30";

  return (
    <Tooltip content={tooltipBody} positioning={{ placement: "top" }}>
      <HStack
        gap={1.5}
        paddingX={2.5}
        paddingY={0.5}
        borderRadius="full"
        borderWidth="1px"
        borderColor={border}
        bg={bg}
        maxWidth="260px"
        minWidth={0}
        overflow="hidden"
        transition="filter 0.12s ease"
        _hover={{ filter: "brightness(1.05)" }}
      >
        {/* Pin icon — non-auto pins click here to unpin. Auto pins are
            non-removable, so the icon is decorative only. */}
        <Box
          as={auto ? "span" : "button"}
          onClick={
            auto
              ? undefined
              : (e: React.MouseEvent) => {
                  e.stopPropagation();
                  onUnpin(pin.source, pin.key);
                }
          }
          aria-label={auto ? undefined : `Unpin ${pin.key}`}
          cursor={auto ? "default" : "pointer"}
          display="inline-flex"
          alignItems="center"
          flexShrink={0}
        >
          <Icon
            as={auto ? LuSparkles : LuPin}
            boxSize={3}
            color={fg}
            flexShrink={0}
          />
        </Box>
        <Text
          textStyle="2xs"
          color={fg}
          fontFamily="mono"
          textTransform="uppercase"
          letterSpacing="0.04em"
          fontWeight="medium"
          truncate
          flexShrink={0}
          maxWidth="100px"
        >
          {label}
        </Text>
        {/* Value: click copies. Doubles as the primary affordance —
            users mostly want the value; unpinning is secondary. */}
        <Box
          as="button"
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            handleCopy();
          }}
          aria-label={`Copy ${pin.key}`}
          cursor="pointer"
          display="inline-flex"
          alignItems="center"
          gap={1}
          minWidth={0}
          flex={1}
          overflow="hidden"
        >
          <Text
            textStyle="xs"
            color={value == null ? "fg.subtle" : "fg"}
            fontFamily="mono"
            fontWeight="medium"
            truncate
            minWidth={0}
            flex={1}
          >
            {copied ? "copied" : display}
          </Text>
          <Icon
            as={copied ? LuCheck : LuCopy}
            boxSize={2.5}
            color={fg}
            opacity={copied ? 1 : 0.55}
            transition="opacity 0.12s ease"
            flexShrink={0}
          />
        </Box>
        {onNavigate && value != null && (
          <Tooltip
            content={navigateLabel ?? "Open"}
            positioning={{ placement: "top" }}
          >
            <Box
              as="button"
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                onNavigate();
              }}
              aria-label={navigateLabel ?? `Open ${pin.key}`}
              cursor="pointer"
              display="inline-flex"
              alignItems="center"
              flexShrink={0}
              opacity={0.55}
              _hover={{ opacity: 1 }}
              transition="opacity 0.12s ease"
            >
              <Icon as={LuArrowUpRight} boxSize={2.5} color={fg} />
            </Box>
          </Tooltip>
        )}
        {onFilter && value != null && (
          <Box
            as="button"
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              onFilter();
            }}
            aria-label={`Filter table by ${pin.key}`}
            cursor="pointer"
            display="inline-flex"
            alignItems="center"
            flexShrink={0}
            opacity={0.55}
            _hover={{ opacity: 1 }}
            transition="opacity 0.12s ease"
          >
            <Icon as={LuFilter} boxSize={2.5} color={fg} />
          </Box>
        )}
      </HStack>
    </Tooltip>
  );
}
