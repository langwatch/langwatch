import { HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { LuPinOff, LuSparkles } from "react-icons/lu";
import { Tooltip } from "~/components/ui/tooltip";
import type { PinnedAttribute } from "../../../stores/pinnedAttributesStore";
import { TooltipRow } from "./TooltipRow";

const PIN_SOURCE_LABEL: Record<PinnedAttribute["source"], string> = {
  attribute: "attr",
  resource: "res",
};

export function PinnedPill({
  pin,
  value,
  auto,
  onUnpin,
}: {
  pin: PinnedAttribute;
  value: string | null;
  auto: boolean;
  onUnpin: (source: PinnedAttribute["source"], key: string) => void;
}) {
  const display = value ?? "—";
  const label = pin.label ?? pin.key;
  // Auto-pins aren't unpinnable yet — they're driven by the trace having a
  // hoisted attribute. Make the pill non-interactive in that case so users
  // don't get confused by a missing-but-implied pin behaviour.
  if (auto) {
    return (
      <Tooltip
        content={
          <VStack align="stretch" gap={0.5} minWidth="160px">
            <TooltipRow label="Auto-pinned" value={pin.key} />
            <TooltipRow label="Value" value={display} />
            <Text textStyle="2xs" color="fg.muted" paddingTop={1}>
              Always shown when present
            </Text>
          </VStack>
        }
        positioning={{ placement: "top" }}
      >
        <HStack
          gap={1.5}
          paddingX={2}
          paddingY={0.5}
          borderRadius="full"
          borderWidth="1px"
          borderColor="purple.solid/30"
          bg="purple.solid/8"
          maxWidth="280px"
        >
          <Icon as={LuSparkles} boxSize={3} color="purple.fg" flexShrink={0} />
          <Text
            textStyle="xs"
            color="purple.fg"
            fontFamily="mono"
            truncate
            maxWidth="100px"
          >
            {label}
          </Text>
          <Text
            textStyle="xs"
            color={value == null ? "fg.subtle" : "fg"}
            fontFamily="mono"
            fontWeight="medium"
            truncate
            maxWidth="160px"
          >
            {display}
          </Text>
        </HStack>
      </Tooltip>
    );
  }
  return (
    <Tooltip
      content={
        <VStack align="stretch" gap={0.5} minWidth="160px">
          <TooltipRow
            label={pin.source === "resource" ? "Resource" : "Attribute"}
            value={pin.key}
          />
          <TooltipRow label="Value" value={display} />
          <Text textStyle="2xs" color="fg.muted" paddingTop={1}>
            Click to unpin
          </Text>
        </VStack>
      }
      positioning={{ placement: "top" }}
    >
      <HStack
        as="button"
        onClick={() => onUnpin(pin.source, pin.key)}
        gap={1.5}
        paddingX={2}
        paddingY={0.5}
        borderRadius="full"
        borderWidth="1px"
        borderColor="border.muted"
        bg="bg.panel"
        cursor="pointer"
        _hover={{ borderColor: "border.emphasized", bg: "bg.muted" }}
        aria-label={`Unpin ${pin.key}`}
        maxWidth="280px"
      >
        <Text
          textStyle="2xs"
          color="fg.subtle"
          fontFamily="mono"
          textTransform="uppercase"
          letterSpacing="0.04em"
          fontWeight="medium"
          flexShrink={0}
        >
          {PIN_SOURCE_LABEL[pin.source]}
        </Text>
        <Text
          textStyle="xs"
          color="fg.muted"
          fontFamily="mono"
          truncate
          maxWidth="100px"
        >
          {label}
        </Text>
        <Text
          textStyle="xs"
          color={value == null ? "fg.subtle" : "fg"}
          fontFamily="mono"
          fontWeight="medium"
          truncate
          maxWidth="160px"
        >
          {display}
        </Text>
        <Icon
          as={LuPinOff}
          boxSize={3}
          color="fg.subtle"
          flexShrink={0}
          opacity={0.6}
        />
      </HStack>
    </Tooltip>
  );
}
