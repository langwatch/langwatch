// Only signed calls: the switch and `Verified("k")` in the condition are one setting. It names the
// key the reader signs with, or says the reader does not sign yet and where to set it up.

import { Link } from "@langwatch/browser-host/link";
import { InlineCode } from "@langwatch/design-system/inline-code";
import { HStack, Stack, Text } from "@langwatch/design-system/primitives";
import { Switch } from "@langwatch/design-system/switch";
import { formatDistanceToNow } from "@langwatch/time";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

import { BRAIDS_GUIDE_HREF } from "../../../../model/braids/braids.ts";

export type ReaderSigning =
  | { state: "loading" | "unknown" }
  | { state: "none" }
  | { state: "signs"; keyName: string; lastUsedAt: string | null };

export type BraidSignedCallsProps = {
  on: boolean;
  onChange: (on: boolean) => void;
  entryKey: string;
  readerName: string | undefined;
  signing: ReaderSigning;
  /** The reader's Signing keys tab; absent when the host does not know the reader's address. */
  readerKeysHref?: string | undefined;
};

function SigningLine({
  readerName,
  signing,
  keysHref,
}: {
  readerName: string;
  signing: ReaderSigning;
  keysHref: string | undefined;
}) {
  if (signing.state === "signs") {
    const used = signing.lastUsedAt
      ? `last used ${formatDistanceToNow(signing.lastUsedAt)} ago`
      : "not used yet";
    return (
      <HStack gap={1} color="green.fg" fontSize="xs" data-testid="braid-signing-key">
        <CheckCircle2 size={12} aria-hidden />
        <Text>{`${readerName} signs its calls · key “${signing.keyName}”, ${used}`}</Text>
      </HStack>
    );
  }
  if (signing.state === "none") {
    return (
      <HStack gap={1} color="orange.fg" fontSize="xs" data-testid="braid-signing-key">
        <AlertTriangle size={12} aria-hidden />
        {keysHref ? (
          <Text>
            {`${readerName} doesn't sign its calls yet, so nothing will show. `}
            <Link href={keysHref} data-testid="braid-create-key">
              Create a key
            </Link>
            {" · "}
            <Link href={`${BRAIDS_GUIDE_HREF}#signing`} isExternal>
              How signing works
            </Link>
          </Text>
        ) : (
          <Text>
            {`${readerName} doesn't sign its calls yet, so nothing will show. Create a key under Signing keys in ${readerName}'s Braids settings. `}
            <Link href={`${BRAIDS_GUIDE_HREF}#signing`} isExternal>
              How signing works
            </Link>
          </Text>
        )}
      </HStack>
    );
  }
  return null;
}

export function BraidSignedCalls(props: BraidSignedCallsProps) {
  const reader = props.readerName ?? "the other project";
  return (
    <HStack
      gap={4}
      align="start"
      justify="space-between"
      padding={3}
      borderWidth="1px"
      borderRadius="lg"
    >
      <Stack gap={1}>
        <Text fontWeight="medium">Only signed calls</Text>
        <Text fontSize="sm" color="fg.muted">
          {`Show spans only when ${reader} really made the call. Adds `}
          <InlineCode>{`Verified("${props.entryKey}")`}</InlineCode>.
        </Text>
        {props.readerName ? (
          <SigningLine
            readerName={props.readerName}
            signing={props.signing}
            keysHref={props.readerKeysHref}
          />
        ) : null}
      </Stack>
      <Switch
        checked={props.on}
        onCheckedChange={({ checked }) => props.onChange(checked)}
        aria-label="Only signed calls"
        data-testid="braid-signed-calls"
      />
    </HStack>
  );
}
