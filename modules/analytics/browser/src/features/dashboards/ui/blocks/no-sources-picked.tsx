/**
 * What a widget draws when none of its queries counts any trace origin: no run, one quiet line.
 * @see modules/dashboard/specs/dashboards-v2.feature AC200m
 */

import { Center, Text } from "@langwatch/design-system/primitives";

export function NoSourcesPicked() {
  return (
    <Center height="full" minHeight="120px" data-testid="no-sources-picked">
      <Text textStyle="bodySm" color="fg.muted">
        No sources picked
      </Text>
    </Center>
  );
}
