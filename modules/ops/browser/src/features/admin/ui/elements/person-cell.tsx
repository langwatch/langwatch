import { Text, VStack } from "@langwatch/design-system/primitives";

import { ShortId } from "./short-id.tsx";

/** A person as an ops screen shows them: the name over the short id, or the id alone. */
export function PersonCell({ id, name }: { id: string; name?: string | null }) {
  return (
    <VStack align="start" gap={0} maxWidth="14rem" minWidth={0}>
      {name ? (
        <Text fontWeight="medium" truncate maxWidth="full">
          {name}
        </Text>
      ) : null}
      <ShortId id={id} />
    </VStack>
  );
}
