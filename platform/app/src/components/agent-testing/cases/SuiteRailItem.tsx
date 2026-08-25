/**
 * The three building blocks of the suites rail: one selectable row, the
 * heading that names a section of rows, and the row-shaped button that ends a
 * section.
 *
 * @see specs/features/agent-testing/suites-rail.feature
 */

import { Box, chakra, HStack, Text } from "@chakra-ui/react";
import { FG_FAINT, FG_MUTED } from "../shared/design";

export type RailSectionHeadingProps = {
  label: string;
  collapsed: boolean;
  /** True for a heading that opens a section under another one. */
  spaced?: boolean;
};

export function RailSectionHeading({
  label,
  collapsed,
  spaced,
}: RailSectionHeadingProps) {
  if (collapsed) return <Box height="8px" />;

  return (
    <Text
      paddingLeft="10px"
      paddingTop={spaced ? 2 : 1.5}
      paddingBottom={0.5}
      fontSize="10px"
      fontWeight="semibold"
      textTransform="uppercase"
      letterSpacing="0.025em"
      color={FG_FAINT}
    >
      {label}
    </Text>
  );
}

export type RailItemProps = {
  label: string;
  /** Absent on the row that stands for every test case. */
  icon?: React.ReactNode;
  selected: boolean;
  collapsed: boolean;
  onClick: () => void;
  actions?: React.ReactNode;
};

/**
 * One row of the rail. The row itself is not a `button` element: it carries
 * the row menu, and a button inside a button is not valid markup. It answers
 * to a click, to Enter and to Space, the way a button does.
 */
export function RailItem({
  label,
  icon,
  selected,
  collapsed,
  onClick,
  actions,
}: RailItemProps) {
  return (
    <HStack
      className="group"
      role="button"
      tabIndex={0}
      aria-current={selected ? "true" : undefined}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        // The row is not a button element, so Space would scroll the rail.
        event.preventDefault();
        onClick();
      }}
      gap={2}
      width="full"
      paddingX="10px"
      paddingY="6px"
      borderRadius="lg"
      textAlign="left"
      cursor="pointer"
      fontSize="12.5px"
      fontWeight={selected ? "medium" : "normal"}
      color={selected ? "fg" : FG_MUTED}
      background={selected ? "bg.muted" : "transparent"}
      _hover={{ background: "bg.muted/60" }}
      data-testid={`suite-rail-item-${label}`}
    >
      {icon}
      {!collapsed && (
        <>
          <Text truncate flex={1} minWidth={0}>
            {label}
          </Text>
          {actions}
        </>
      )}
    </HStack>
  );
}

/** The row-shaped button that adds one more entry to a section. */
export function RailAddButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <chakra.button
      type="button"
      onClick={onClick}
      display="flex"
      alignItems="center"
      gap={2}
      width="full"
      paddingX="10px"
      paddingY="6px"
      borderRadius="lg"
      textAlign="left"
      cursor="pointer"
      fontSize="12px"
      color={FG_FAINT}
      _hover={{ background: "bg.muted/60", color: FG_MUTED }}
    >
      {icon}
      <Text>{label}</Text>
    </chakra.button>
  );
}
