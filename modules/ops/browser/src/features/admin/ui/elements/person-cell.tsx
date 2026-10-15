import { Text, VStack } from "@langwatch/design-system/primitives";

import { ShortId } from "./short-id.tsx";

/** A person as an ops screen shows them: the name over the short id, or the id alone. */
export function PersonCell({ id, name }: { id: string; name?: string | null }) {
  if (!name) return <ShortId id={id} />;
  return (
    <VStack align="start" gap={0}>
      <Text fontWeight="medium">{name}</Text>
      <ShortId id={id} />
    </VStack>
  );
}
