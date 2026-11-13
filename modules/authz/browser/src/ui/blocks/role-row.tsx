// One role as one 40px line of a boxed list: who it is, what it is for, how many hold it,
// how much it grants and the one thing the reader can do with it.

import { Box, HStack, Text } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

import type { RoleDotPalette } from "../../model/builtin-roles.ts";

/** The columns of a role line. */
const ROLE_ROW_COLUMNS = "230px minmax(0, 1fr) 80px 110px 150px";

const DOT_COLOR: Record<RoleDotPalette, string> = {
  orange: "orange.solid",
  green: "green.solid",
  gray: "gray.400",
  blue: "blue.solid",
};

/** The coloured mark a built-in role leads with; a custom role keeps the space empty. */
export function RoleDot({ palette }: { palette: RoleDotPalette | null }) {
  return (
    <Box
      width="8px"
      height="8px"
      borderRadius="full"
      flexShrink={0}
      background={palette ? DOT_COLOR[palette] : "transparent"}
      aria-hidden="true"
    />
  );
}

export function peopleLabel(people: number): string {
  return `${people} ${people === 1 ? "person" : "people"}`;
}

export function permissionsLabel(count: number): string {
  return `${count} ${count === 1 ? "permission" : "permissions"}`;
}

export function RoleRow({
  dot,
  name,
  description,
  people,
  permissions,
  action,
  "data-testid": testId,
}: {
  dot: RoleDotPalette | null;
  name: string;
  description: string | null;
  /** How many people hold it, or null when that could not be read. */
  people: number | null;
  permissions: number;
  action: ReactNode;
  "data-testid"?: string;
}) {
  return (
    <Box
      display="grid"
      gridTemplateColumns={ROLE_ROW_COLUMNS}
      alignItems="center"
      gap={3}
      minHeight={10}
      paddingX={3}
      textStyle="bodySm"
      data-testid={testId}
    >
      <HStack gap={2} minWidth={0}>
        <RoleDot palette={dot} />
        <Text textStyle="label" color="fg" truncate>
          {name}
        </Text>
      </HStack>
      <Text textStyle="bodySm" color="fg.muted" truncate title={description ?? void 0}>
        {description ?? ""}
      </Text>
      <Text textStyle="bodySm" color={people === null ? "fg.subtle" : "fg.muted"} textAlign="right">
        {people === null ? "Unavailable" : peopleLabel(people)}
      </Text>
      <Text textStyle="bodySm" color="fg.muted" textAlign="right" fontVariantNumeric="tabular-nums">
        {permissionsLabel(permissions)}
      </Text>
      <Box textAlign="right">{action}</Box>
    </Box>
  );
}
