import { Box, Grid, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";

/** Compact semantic label/value pairs. Use SummaryListItem for each row. */
export function SummaryList({ children }: { children: ReactNode }) {
  return (
    <Grid
      as="dl"
      templateColumns={{ base: "1fr", sm: "112px minmax(0, 1fr)" }}
      columnGap={4}
      rowGap={3}
      fontSize="sm"
    >
      {children}
    </Grid>
  );
}

/** Null, absent and empty string values read as a dash; zero remains a value. */
export function SummaryListItem({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <>
      <Text as="dt" color="fg.muted">
        {label}
      </Text>
      <Box as="dd" minWidth={0} overflowWrap="anywhere">
        {children == null || children === "" ? "—" : children}
      </Box>
    </>
  );
}
