import { Box, chakra, Flex, Icon, Text } from "@chakra-ui/react";
import { LuChevronDown, LuChevronUp } from "react-icons/lu";

function EarlierTurnsHeader({
  icon,
  label,
  onClick,
}: {
  icon: typeof LuChevronDown;
  label: string;
  onClick: () => void;
}) {
  return (
    <Box position="relative" paddingLeft={6} paddingY={0}>
      <Flex
        position="absolute"
        left={0}
        top="6px"
        width="14px"
        height="14px"
        align="center"
        justify="center"
        flexShrink={0}
      >
        <Icon as={icon} boxSize="10px" color="fg.subtle" />
      </Flex>
      <chakra.button
        type="button"
        onClick={onClick}
        display="flex"
        alignItems="center"
        paddingY={0.5}
        paddingX={1.5}
        borderRadius="sm"
        cursor="pointer"
        _hover={{ bg: "bg.muted" }}
        textAlign="left"
        width="full"
      >
        <Text
          textStyle="2xs"
          color="fg.muted"
          fontWeight="600"
          textTransform="uppercase"
          letterSpacing="0.06em"
          lineHeight={1.4}
        >
          {label}
        </Text>
      </chakra.button>
    </Box>
  );
}

export function EarlierTurnsExpander({
  hiddenCount,
  onClick,
}: {
  hiddenCount: number;
  onClick: () => void;
}) {
  return (
    <EarlierTurnsHeader
      icon={LuChevronDown}
      label={`Show ${hiddenCount} earlier turn${hiddenCount === 1 ? "" : "s"}`}
      onClick={onClick}
    />
  );
}

export function CollapseEarlierToggle({ onClick }: { onClick: () => void }) {
  return (
    <EarlierTurnsHeader icon={LuChevronUp} label="Hide earlier turns" onClick={onClick} />
  );
}
