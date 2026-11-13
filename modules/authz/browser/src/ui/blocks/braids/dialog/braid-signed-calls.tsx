// Only signed calls: the switch and `Verified("k")` in the condition are one setting. It names the
// key the reader signs with, or says the reader does not sign yet and where to set it up.

import { Link } from "@langwatch/browser-host/link";
import { InlineCode } from "@langwatch/design-system/inline-code";
import { Alert, Box, HStack, Stack, Text } from "@langwatch/design-system/primitives";
import { Switch } from "@langwatch/design-system/switch";
import { formatDistanceToNow } from "@langwatch/time";
import { ShieldCheck } from "lucide-react";

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
  on,
  keysHref,
}: {
  on: boolean;
  readerName: string;
  signing: ReaderSigning;
  keysHref: string | undefined;
}) {
  if (signing.state === "signs") {
    const used = signing.lastUsedAt
      ? `last used ${formatDistanceToNow(signing.lastUsedAt)} ago`
      : "not used yet";
    return (
      <HStack gap={1.5} textStyle="sm" color="fg.muted" data-testid="braid-signing-key">
        <Box as="span" color="fg.success" flexShrink={0}>
          <ShieldCheck size={14} aria-hidden />
        </Box>
        <Text>{`${readerName} signs its calls · key “${signing.keyName}”, ${used}`}</Text>
      </HStack>
    );
  }
  if (signing.state === "none" && on) {
    return (
      <Alert.Root status="warning" size="sm" data-testid="braid-signing-key">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>{`${readerName} doesn't sign its calls yet, so nothing will show.`}</Alert.Title>
          <Alert.Description>
            {keysHref ? (
              <Link href={keysHref} isExternal data-testid="braid-create-key">
                Create a key (opens in a new tab)
              </Link>
            ) : (
              `Create a key under Signing keys in ${readerName}'s Braids settings.`
            )}
            {" · "}
            <Link href={`${BRAIDS_GUIDE_HREF}#signing`} isExternal>
              How signing works
            </Link>
          </Alert.Description>
        </Alert.Content>
      </Alert.Root>
    );
  }
  return null;
}

export function BraidSignedCalls(props: BraidSignedCallsProps) {
  const reader = props.readerName ?? "the other project";
  return (
    <Stack gap={2}>
      {/* Stacked, as a dialog's fields are, with the switch beside its caption. */}
      <HStack justify="space-between" align="start" gap={4}>
        <Stack gap={0.5}>
          <Text textStyle="sm" fontWeight="medium">
            Only signed calls
          </Text>
          <Text textStyle="sm" color="fg.muted">
            {`Show spans only when ${reader} really made the call. Adds `}
            <InlineCode variant="neutral">{`Verified("${props.entryKey}")`}</InlineCode> to the
            condition.
          </Text>
        </Stack>
        <Switch
          checked={props.on}
          onCheckedChange={({ checked }) => props.onChange(checked)}
          aria-label="Only signed calls"
          data-testid="braid-signed-calls"
        />
      </HStack>
      {props.readerName ? (
        <SigningLine
          readerName={props.readerName}
          signing={props.signing}
          on={props.on}
          keysHref={props.readerKeysHref}
        />
      ) : null}
    </Stack>
  );
}
