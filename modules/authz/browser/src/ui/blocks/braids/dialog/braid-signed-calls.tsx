// Only signed calls: the switch and `Verified("k")` in the condition are one setting. It speaks up
// only when signing is in the way: the reader has no key yet, or its key has never signed a call.

import { Link } from "@langwatch/browser-host/link";
import { Alert, Stack } from "@langwatch/design-system/primitives";
import { Switch } from "@langwatch/design-system/switch";
import { ToggleRow } from "@langwatch/design-system/toggle-row";

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

/** Says something only when signing is in the way: no key yet, or a key that never signed. */
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
  if (!on) return null;
  if (signing.state === "signs" && signing.lastUsedAt === null) {
    return (
      <Alert.Root status="warning" size="sm" data-testid="braid-signing-key">
        <Alert.Indicator />
        <Alert.Title fontWeight="normal">
          {`${readerName}'s key “${signing.keyName}” has not signed a call yet, so nothing shows until it does.`}
        </Alert.Title>
      </Alert.Root>
    );
  }
  if (signing.state !== "none") return null;
  return (
    <Alert.Root status="warning" size="sm" data-testid="braid-signing-key">
      <Alert.Indicator />
      <Alert.Title fontWeight="normal">
        {`${readerName} doesn't sign its calls yet, so nothing will show. `}
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
      </Alert.Title>
    </Alert.Root>
  );
}

export function BraidSignedCalls(props: BraidSignedCallsProps) {
  const reader = props.readerName ?? "the other project";
  return (
    <Stack gap={2}>
      <ToggleRow
        label="Only signed calls"
        hint={`Show spans only when ${reader} really made the call.`}
        on={props.on}
      >
        <Switch
          checked={props.on}
          onCheckedChange={({ checked }) => props.onChange(checked)}
          aria-label="Only signed calls"
          data-testid="braid-signed-calls"
        />
      </ToggleRow>
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
