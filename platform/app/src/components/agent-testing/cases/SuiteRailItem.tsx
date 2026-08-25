/**
 * The two building blocks of the suites rail: one selectable row, and the
 * heading that names a section of rows.
 *
 * @see specs/features/agent-testing/suites-rail.feature
 */

import { Box, HStack, Spacer, Text } from "@chakra-ui/react";

export type RailSectionHeadingProps = {
  label: string;
  collapsed: boolean;
  action?: React.ReactNode;
};

export function RailSectionHeading({
  label,
  collapsed,
  action,
}: RailSectionHeadingProps) {
  if (collapsed) return <Box height="8px" />;

  return (
    <HStack gap={1} paddingX={2} paddingTop={3} paddingBottom={1}>
      <Text
        fontSize="xs"
        fontWeight="bold"
        textTransform="uppercase"
        color="fg.muted"
        letterSpacing="0.04em"
      >
        {label}
      </Text>
      <Spacer />
      {action}
    </HStack>
  );
}

export type RailItemProps = {
  label: string;
  caption?: string;
  icon: React.ReactNode;
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
  caption,
  icon,
  selected,
  collapsed,
  onClick,
  actions,
}: RailItemProps) {
  return (
    <HStack
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
      paddingX={2}
      paddingY={1.5}
      borderRadius="md"
      textAlign="left"
      cursor="pointer"
      background={selected ? "bg.muted" : "transparent"}
      _hover={{ background: "bg.muted" }}
      data-testid={`suite-rail-item-${label}`}
    >
      {icon}
      {!collapsed && (
        <>
          <Text fontSize="sm" truncate flex={1} minWidth={0}>
            {label}
          </Text>
          {caption && (
            <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap">
              {caption}
            </Text>
          )}
          {actions}
        </>
      )}
    </HStack>
  );
}
