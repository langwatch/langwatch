import { Button, HStack, Text } from "@chakra-ui/react";
import { Copy } from "lucide-react";
import { toaster } from "~/components/ui/toaster";
import { shortenIdentifier } from "./identityLookupCopy";

/**
 * An identifier that has to be shown: shortened in its middle, with a way to
 * copy it whole.
 *
 * People and organizations are named on the operator surfaces; an id appears
 * only where there is nothing else to say. When one does appear it stays
 * comparable — both ends survive, because the prefix says what kind of thing
 * it is and the suffix is what tells two of them apart in a log line — and
 * it stays usable, because an operator who cannot paste it whole into a
 * query has been shown a picture of an id rather than an id.
 */
export function ShortId({ id }: { id: string }) {
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
