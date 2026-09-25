import { Button, HStack, Text } from "@chakra-ui/react";
import { Copy } from "lucide-react";

import { useOpsToaster } from "../../../../behavior/ops-feedback.ts";
import { shortenIdentifier } from "../../model/identity-lookup-copy.ts";

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
