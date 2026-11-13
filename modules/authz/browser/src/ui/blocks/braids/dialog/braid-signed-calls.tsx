// Only signed calls: the switch and `Verified("k")` in the condition are one setting. It names the
// key the reader signs with, or says the reader does not sign yet and where to set it up.

import { Link } from "@langwatch/browser-host/link";
import { InlineCode } from "@langwatch/design-system/inline-code";
import { Alert, Box, Stack } from "@langwatch/design-system/primitives";
import { SettingsField } from "@langwatch/design-system/settings-field";
import { Switch } from "@langwatch/design-system/switch";
import { formatDistanceToNow } from "@langwatch/time";

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
      <Alert.Root status="success" size="sm" data-testid="braid-signing-key">
        <Alert.Indicator />
        <Alert.Title fontWeight="normal">
          {`${readerName} signs its calls · key “${signing.keyName}”, ${used}`}
        </Alert.Title>
      </Alert.Root>
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
      {/* The Box keeps the field the last row of its own group, so no rule draws under it. */}
      <Box>
        <SettingsField
          layout="inline"
          controlAlign="end"
          label="Only signed calls"
          hint={
            <>
              {`Show spans only when ${reader} really made the call. Adds `}
              <InlineCode variant="neutral">{`Verified("${props.entryKey}")`}</InlineCode> to the
              condition.
            </>
          }
        >
          <Switch
            checked={props.on}
            onCheckedChange={({ checked }) => props.onChange(checked)}
            aria-label="Only signed calls"
            data-testid="braid-signed-calls"
          />
        </SettingsField>
      </Box>
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
