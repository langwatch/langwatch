import { Button, HStack, Text } from "@chakra-ui/react";
import { Copy } from "lucide-react";

import { useOpsToaster } from "../../../../behavior/ops-feedback.ts";

/** A long identifier, shortened in its middle: both ends carry meaning, the
 * prefix says what kind of thing it is and the suffix tells two apart. */
function shortenIdentifier(id: string): string {
  if (id.length <= 14) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

/** An identifier shown shortened, with a way to copy it whole. */
export function ShortId({ id }: { id: string }) {
  const toaster = useOpsToaster();
  return (
    <HStack gap={1}>
      <Text fontSize="xs" color="fg.muted" fontFamily="mono">
        {shortenIdentifier(id)}
      </Text>
      <Button
        size="2xs"
        variant="ghost"
        aria-label={`Copy ${id}`}
        onClick={(event) => {
          event.stopPropagation();
          void navigator.clipboard?.writeText(id);
          toaster.create({ title: "Copied", type: "success", duration: 1500 });
        }}
      >
        <Copy size={11} />
      </Button>
    </HStack>
  );
}
