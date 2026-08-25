import {
  Box,
  Button,
  Field,
  HStack,
  Input,
  Spacer,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Fingerprint, MoreVertical, Usb } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { SettingsRowsSkeleton } from "~/components/settings/kit/SettingsSkeleton";
import { QuietNotice } from "~/components/settings/QuietNotice";
import { SettingsEmptyState } from "~/components/settings/SettingsEmptyState";
import {
  SettingsSection,
  SettingsSectionRow,
} from "~/components/settings/SettingsSection";
import { Dialog } from "~/components/ui/dialog";
import { Menu } from "~/components/ui/menu";
import { toaster } from "~/components/ui/toaster";
import {
  PasskeyCeremonyPanel,
  passkeyCeremonyTitle,
} from "~/features/auth/components/PasskeyCeremonyPanel";
import {
  cancelPasskeyCeremony,
  endPasskeyCeremony,
  startPasskeyCeremony,
  usePasskeyCeremony,
} from "~/features/auth/logic/passkeyCeremony";
import { showErrorToast } from "~/features/errors";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { authClient } from "~/utils/auth-client";
import { useLastWayInWarning } from "./useLastWayInWarning";

/** What the plugin stores per credential, of the parts this screen reads. */
interface HeldPasskey {
  id: string;
  name?: string | null;
  createdAt: string | Date;
  transports?: string | null;
}

/**
 * Whether this one lives on a key somebody carries rather than on a device
 * they own.
 *
 * Read off TRANSPORTS rather than `deviceType`, which is the tempting field
 * and the wrong one: `deviceType` says whether the credential syncs, and a
 * platform authenticator that does not sync is still on the person's laptop,
 * not on a key in their pocket. `usb`, `nfc` and `ble` are how a roaming
 * authenticator is reached, and nothing else is reached that way.
 *
 * It stays a heuristic — transports are a hint the authenticator supplies —
 * so it decides only which HEADING a card sits under, never anything that
 * would matter if it were wrong.
 */
function isSecurityKey(passkey: HeldPasskey): boolean {
  const transports = passkey.transports ?? "";
  return ["usb", "nfc", "ble"].some((transport) =>
    transports.includes(transport),
  );
}

/**
 * What to call one in a list of them.
 *
 * A passkey registered from the sign-up screen is labelled with the address it
 * was created for; one added from settings carries whatever the browser chose,
 * which is often nothing. "Passkey" is the honest fallback — better than an
 * id, and it is exactly why renaming exists.
 */
function passkeyLabel(passkey: HeldPasskey): string {
  return passkey.name?.trim() || "Passkey";
}

/**
 * Giving a passkey a name somebody will recognise later.
 *
 * The guidance is blunt about why this matters: a person with three passkeys
 * and no names cannot tell which is the work laptop and which is the phone
 * they no longer own, so they remove none of them. A name is what makes the
 * list actionable, and it is the one thing the ceremony cannot supply.
 */
function RenamePasskeyDialog({
  passkey,
  onClose,
  onRename,
}: {
  passkey: HeldPasskey | null;
  onClose: () => void;
  onRename: (input: { id: string; name: string }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Seeded from the passkey being renamed rather than held in sync with it:
  // the dialog opens once per passkey, and re-seeding on every render would
  // fight whatever is being typed.
  useEffect(() => {
    if (passkey) setName(passkey.name ?? "");
  }, [passkey]);

  const save = async () => {
    if (!passkey) return;
    setIsSaving(true);
    try {
      await onRename({ id: passkey.id, name: name.trim() });
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog.Root
      open={!!passkey}
      onOpenChange={(details) => {
        if (!details.open) onClose();
      }}
      placement="center"
    >
      <Dialog.Content bg="bg">
        <Dialog.CloseTrigger />
        <Dialog.Header>
          <Dialog.Title fontSize="md" fontWeight="500">
            Rename passkey
          </Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <Field.Root>
            <Field.Label>Name</Field.Label>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Work laptop"
              data-testid="passkey-name"
            />
          </Field.Root>
        </Dialog.Body>
        <Dialog.Footer>
          <HStack gap={3} justify="end" width="full">
            <Button variant="outline" onClick={onClose} disabled={isSaving}>
              Cancel
            </Button>
            <Button
              colorPalette="orange"
              loading={isSaving}
              disabled={!name.trim()}
              onClick={() => void save()}
              data-testid="save-passkey-name"
            >
              Save
            </Button>
          </HStack>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

/**
 * Confirming a removal, because a passkey is a way in and this is the click
 * that ends it. Named, so nobody removes the wrong one from a list of three.
 */
function RemovePasskeyDialog({
  passkey,
  onClose,
  onRemove,
}: {
  passkey: HeldPasskey | null;
  onClose: () => void;
  onRemove: (id: string) => Promise<void>;
}) {
  const [isRemoving, setIsRemoving] = useState(false);

  const remove = async () => {
    if (!passkey) return;
    setIsRemoving(true);
    try {
      await onRemove(passkey.id);
      onClose();
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <Dialog.Root
      open={!!passkey}
      onOpenChange={(details) => {
        if (!details.open) onClose();
      }}
      placement="center"
    >
      <Dialog.Content bg="bg">
        <Dialog.CloseTrigger />
        <Dialog.Header>
          <Dialog.Title fontSize="md" fontWeight="500">
            Remove {passkey ? passkeyLabel(passkey) : "passkey"}?
          </Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <Text fontSize="sm" color="fg.muted">
            You will not be able to sign in with it again. The passkey stays on
            your device until you delete it there too.
          </Text>
        </Dialog.Body>
        <Dialog.Footer>
          <HStack gap={3} justify="end" width="full">
            <Button variant="outline" onClick={onClose} disabled={isRemoving}>
              Cancel
            </Button>
            <Button
              colorPalette="red"
              loading={isRemoving}
              onClick={() => void remove()}
              data-testid="confirm-remove-passkey"
            >
              Remove
            </Button>
          </HStack>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

/**
 * One group of cards under a heading it earns. Renders nothing when empty:
 * "Passkeys on security keys (0)" is a heading about an absence, and the
 * page is not a report.
 */
function PasskeyGroup({
  heading,
  passkeys,
  onRename,
  onRemove,
}: {
  heading: string;
  passkeys: HeldPasskey[];
  onRename: (passkey: HeldPasskey) => void;
  onRemove: (passkey: HeldPasskey) => void;
}) {
  if (passkeys.length === 0) return null;

  return (
    <VStack width="full" align="stretch" gap={2}>
      {/* Named for where the thing IS, not for what the specification calls
          it: nobody has ever wanted a "device-bound credential". */}
      <Text fontSize="xs" color="fg.muted" fontWeight={600}>
        {heading}
      </Text>
      {passkeys.map((passkey) => (
        <SettingsSectionRow key={passkey.id} testId="passkey-card">
          <Box color="fg.muted" display="flex">
            {isSecurityKey(passkey) ? (
              <Usb size={16} />
            ) : (
              <Fingerprint size={16} />
            )}
          </Box>
          <VStack align="start" gap={0}>
            <Text fontSize="sm" fontWeight={500}>
              {passkeyLabel(passkey)}
            </Text>
            <Text fontSize="xs" color="fg.muted">
              Added {new Date(passkey.createdAt).toLocaleDateString()}
            </Text>
          </VStack>
          <Spacer />
          {/* One trigger per row, per row-actions-overflow-menu.md: two icon
              buttons in a row is the pattern that doc exists to stop, and it
              puts a destructive action one stray click from a credential. */}
          <Menu.Root>
            <Menu.Trigger asChild>
              <Button
                size="xs"
                variant="ghost"
                aria-label={`Actions for ${passkeyLabel(passkey)}`}
              >
                <MoreVertical size={14} />
              </Button>
            </Menu.Trigger>
            <Menu.Content>
              <Menu.Item value="rename" onClick={() => onRename(passkey)}>
                Rename
              </Menu.Item>
              <Menu.Item
                value="remove"
                color="red.500"
                onClick={() => onRemove(passkey)}
              >
                Remove
              </Menu.Item>
            </Menu.Content>
          </Menu.Root>
        </SettingsSectionRow>
      ))}
    </VStack>
  );
}

/**
 * One way in and no other, said where the remedy is.
 *
 * Quiet on purpose: it is a fact about the account rather than a failure, and
 * the moment it looks like an error is the moment people learn to scroll past
 * it. It names the real risk — losing the passkey PROVIDER, not misplacing a
 * phone — because the opposite framing is the misconception the guidance
 * (passkeycentral.org) says people already hold, and repeating it here would
 * teach it.
 */
function LastWayInNotice() {
  const warning = useLastWayInWarning();
  if (!warning) return null;

  return (
    <QuietNotice testId="last-way-in-notice">
      <Text fontSize="sm" lineHeight="1.55" data-case={warning.id}>
        {warning.message}
      </Text>
    </QuietNotice>
  );
}

/**
 * Creating, seeing and removing passkeys, in the one place somebody goes
 * looking for them (Passkey Central, "Create, view and manage passkeys in
 * account settings").
 *
 * One HALF of a band it shares with two-step verification, and above the
 * password on purpose. The order of a settings page is an argument about what
 * the account should be secured with, and putting the thing we would rather
 * people used underneath the thing we would rather they stopped using makes
 * the opposite one.
 *
 * With nothing enrolled it is a hero rather than an empty list: an empty list
 * says "you have none of these" to somebody who does not know what they are,
 * and the whole difficulty with passkeys is that most people have never
 * knowingly made one. So the empty state explains, in the guide's own words,
 * what a passkey is and where it lives — in terms of the fingerprint or face
 * somebody already uses — and offers to make one.
 */
export function PasskeysSection() {
  const publicEnv = usePublicEnv();
  const passkeys = authClient.useListPasskeys();
  const [isCreating, setIsCreating] = useState(false);
  // Which passkey a dialog is open for, or null. Held as the row rather than
  // an id so the dialogs can name it — "Remove?" over a list of three
  // identical-looking cards is not a question anybody can answer.
  const [renaming, setRenaming] = useState<HeldPasskey | null>(null);
  const [removing, setRemoving] = useState<HeldPasskey | null>(null);
  // The ceremony this page started, if it is the one in flight. Read before
  // any early return: a hook cannot be called conditionally, and the flag
  // check below is a return.
  const ceremony = usePasskeyCeremony();
  const registering = ceremony?.purpose === "register" ? ceremony : null;
  const abandoned = useRef<{ abandoned: boolean } | null>(null);

  // A deployment that never mounted the plugin has no endpoint behind any of
  // this. Rendering the hero there would be an offer we cannot honour.
  if (publicEnv.data?.PASSKEYS_ENABLED !== true) return null;

  const held = passkeys.data ?? [];

  const create = () => {
    setIsCreating(true);
    const current = { abandoned: false };
    abandoned.current = current;
    // The ceremony is the browser's and the wait can be long — a phone across
    // the room, a security key in a bag. The dialog that opens on this says
    // whose prompt it is and how to stop waiting; a spinner on the button
    // would say neither.
    startPasskeyCeremony({
      purpose: "register",
      cancel: () => {
        current.abandoned = true;
        setIsCreating(false);
      },
      retry: create,
    });
    void runCreate(current);
  };

  const runCreate = async (current: { abandoned: boolean }) => {
    try {
      const result = await authClient.passkey.addPasskey({});
      if (current.abandoned) return;
      // A cancelled prompt is not a failure. Somebody opened the OS dialog,
      // looked at it and closed it; saying "something went wrong" about a
      // decision would be telling them off for deciding.
      if (result?.error) {
        if (result.error.status !== 0) {
          // Words from the code-keyed registry, never the endpoint's own
          // sentence: the wire message for a handled refusal IS the code.
          showErrorToast({
            error: result.error,
            fallbackTitle: "That passkey wasn't created",
          });
        }
        return;
      }
      toaster.success({ title: "Passkey created" });
    } catch (error) {
      if (!current.abandoned) {
        showErrorToast({ error, fallbackTitle: "That passkey wasn't created" });
      }
    } finally {
      if (!current.abandoned) {
        setIsCreating(false);
        endPasskeyCeremony();
      }
    }
  };

  const remove = async (id: string) => {
    try {
      const result = await authClient.passkey.deletePasskey({ id });
      if (result?.error) {
        // The detach guards decide this, and their refusal is a registered
        // code — "you'd have no way back into your account", with the remedy.
        // A flat "try again in a moment" about a refusal that will never
        // change on a retry is the worst of both.
        showErrorToast({
          error: result.error,
          fallbackTitle: "That passkey wasn't removed",
        });
        return;
      }
      toaster.success({ title: "Passkey removed" });
    } catch (error) {
      showErrorToast({ error, fallbackTitle: "That passkey wasn't removed" });
    }
  };

  const rename = async ({ id, name }: { id: string; name: string }) => {
    try {
      const result = await authClient.passkey.updatePasskey({ id, name });
      if (result?.error) {
        toaster.error({
          title: "That passkey wasn't renamed",
          description: "Try again in a moment.",
        });
        return;
      }
      toaster.success({ title: "Passkey renamed" });
    } catch {
      toaster.error({
        title: "That passkey wasn't renamed",
        description: "Try again in a moment.",
      });
    }
  };

  return (
    <SettingsSection
      anchorId="passkeys"
      icon={<Fingerprint size={18} />}
      title="Passkeys"
      description="Sign in with the fingerprint, face or screen lock you already use. There is nothing to remember and nothing to phish."
      testId="passkeys-settings-section"
    >
      <VStack width="full" align="start" gap={4} data-testid="passkeys-section">
        <LastWayInNotice />
        {passkeys.isPending ? <SettingsRowsSkeleton rows={2} /> : null}

        {!passkeys.isPending && held.length === 0 ? (
          // Said in terms of what somebody already does with their device,
          // because "public key credential" is not a thing anybody has wanted.
          <SettingsEmptyState
            icon={<Fingerprint size={20} />}
            title="No passkeys yet"
            description="A passkey is an encrypted key you create with your fingerprint, face or screen lock. It is kept by your passkey provider, so it works on your other devices too."
            testId="passkeys-empty"
            action={
              <Button
                variant="outline"
                loading={isCreating}
                onClick={() => void create()}
                data-testid="create-passkey"
              >
                Create a passkey
              </Button>
            }
          />
        ) : null}

        {held.length > 0 ? (
          <VStack width="full" align="stretch" gap={5}>
            <PasskeyGroup
              heading="Passkeys on your devices"
              passkeys={held.filter((passkey) => !isSecurityKey(passkey))}
              onRename={setRenaming}
              onRemove={setRemoving}
            />
            <PasskeyGroup
              heading="Passkeys on security keys"
              passkeys={held.filter(isSecurityKey)}
              onRename={setRenaming}
              onRemove={setRemoving}
            />
            <Box>
              <Button
                variant="outline"
                size="sm"
                loading={isCreating}
                onClick={() => void create()}
                data-testid="create-passkey"
              >
                Create a passkey
              </Button>
            </Box>
          </VStack>
        ) : null}

        {/* The waiting state, as a dialog: the ceremony has to sit over the
            list it was started from. Same panel, same words, same still glyph
            under reduced motion as the auth screens'. */}
        <Dialog.Root
          open={registering !== null}
          onOpenChange={(details) => {
            if (!details.open) cancelPasskeyCeremony();
          }}
          placement="center"
        >
          <Dialog.Content bg="bg" data-testid="passkey-ceremony-dialog">
            <Dialog.Header>
              <Dialog.Title fontSize="md" fontWeight="500">
                {registering
                  ? passkeyCeremonyTitle(registering)
                  : "Use your passkey"}
              </Dialog.Title>
            </Dialog.Header>
            <Dialog.Body paddingBottom={6}>
              {registering ? (
                <PasskeyCeremonyPanel ceremony={registering} />
              ) : null}
            </Dialog.Body>
          </Dialog.Content>
        </Dialog.Root>

        <RenamePasskeyDialog
          passkey={renaming}
          onClose={() => setRenaming(null)}
          onRename={rename}
        />
        <RemovePasskeyDialog
          passkey={removing}
          onClose={() => setRemoving(null)}
          onRemove={remove}
        />
      </VStack>
    </SettingsSection>
  );
}
