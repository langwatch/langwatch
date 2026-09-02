/**
 * Creating, seeing and removing passkeys, in the one place somebody goes
 * looking for them (Passkey Central: "Create, view and manage passkeys in
 * account settings").
 *
 * Moved from `platform/app/src/components/me/PasskeysSection.tsx`. Every word
 * of copy, both headings and the empty-state hero travel unchanged; what
 * changed is where the ceremonies live. `authClient.passkey.*` is `better-auth`
 * in a screen's closure, which ADR-004 seals off, so the four calls are host
 * methods and the wire is `apps/ui/src/behavior/ui-passkeys.ts`.
 *
 * ONE BEHAVIOURAL DIFFERENCE, NAMED. `authClient.useListPasskeys()` was a
 * reactive hook the plugin re-ran after each of its own writes; a port method
 * cannot be, so the list is re-read here after every ceremony that changes it.
 * The reader sees the same thing; the refresh is explicit rather than implied.
 *
 * It sits ABOVE the password section on purpose. The order of a settings page
 * is an argument about what an account should be secured with, and putting the
 * thing we would rather people used underneath the thing we would rather they
 * stopped using makes the opposite one.
 */

import {
  Box,
  Button,
  Card,
  Field,
  HStack,
  Input,
  Spacer,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Dialog } from "@langwatch/design-system/dialog";
import { Menu } from "@langwatch/design-system/menu";
import { Fingerprint, MoreVertical, Usb } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { isSecurityKey, passkeyLabel } from "../../model/sign-in-methods";
import {
  usePersonalWorkspaceHost,
  type HeldPasskey,
  type PasskeyOutcome,
} from "../../model/personal-workspace-host";

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

  // Seeded from the passkey being renamed rather than held in sync with it: the
  // dialog opens once per passkey, and re-seeding on every render would fight
  // whatever is being typed.
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
            You will not be able to sign in with it again. The passkey stays on your device until
            you delete it there too.
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
 * "Passkeys on security keys (0)" is a heading about an absence, and the page
 * is not a report.
 */
function PasskeyGroup({
  heading,
  passkeys,
  onRename,
  onRemove,
}: {
  heading: string;
  passkeys: readonly HeldPasskey[];
  onRename: (passkey: HeldPasskey) => void;
  onRemove: (passkey: HeldPasskey) => void;
}) {
  if (passkeys.length === 0) return null;

  return (
    <VStack width="full" align="stretch" gap={2}>
      {/* Named for where the thing IS, not for what the specification calls it:
          nobody has ever wanted a "device-bound credential". */}
      <Text fontSize="xs" color="fg.muted" fontWeight={600}>
        {heading}
      </Text>
      {passkeys.map((passkey) => (
        <Card.Root key={passkey.id} width="full" data-testid="passkey-card">
          <Card.Body paddingY={3}>
            <HStack>
              <Box color="fg.muted" display="flex">
                {isSecurityKey(passkey) ? <Usb size={16} /> : <Fingerprint size={16} />}
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
                  <Menu.Item value="remove" color="red.500" onClick={() => onRemove(passkey)}>
                    Remove
                  </Menu.Item>
                </Menu.Content>
              </Menu.Root>
            </HStack>
          </Card.Body>
        </Card.Root>
      ))}
    </VStack>
  );
}

export function PasskeysSection() {
  const host = usePersonalWorkspaceHost();
  const passkeysEnabled = host.deployment().passkeysEnabled;

  const [held, setHeld] = useState<readonly HeldPasskey[]>([]);
  const [isPending, setIsPending] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  // Which passkey a dialog is open for, or null. Held as the row rather than an
  // id so the dialogs can name it — "Remove?" over a list of three
  // identical-looking cards is not a question anybody can answer.
  const [renaming, setRenaming] = useState<HeldPasskey | null>(null);
  const [removing, setRemoving] = useState<HeldPasskey | null>(null);

  const reload = useCallback(async () => {
    setIsPending(true);
    try {
      setHeld(await host.listPasskeys());
    } finally {
      setIsPending(false);
    }
  }, [host]);

  useEffect(() => {
    if (!passkeysEnabled) return;
    void reload();
  }, [passkeysEnabled, reload]);

  /**
   * Says what happened, and says nothing at all about a decision.
   *
   * A cancelled prompt is somebody opening the operating system's dialog,
   * looking at it and closing it. Reporting that as a failure is telling them
   * off for deciding, which is why `cancelled` exists on the outcome at all.
   */
  const report = async (
    outcome: PasskeyOutcome,
    { done, failed, description }: { done: string; failed: string; description: string },
  ) => {
    if (outcome.ok) {
      host.succeeded({ title: done });
      await reload();
      return;
    }
    if (outcome.cancelled) return;
    host.failed({ error: new Error(failed), fallbackTitle: failed, description });
  };

  // A deployment that never mounted the plugin has no endpoint behind any of
  // this. Rendering the hero there would be an offer we cannot honour.
  if (!passkeysEnabled) return null;

  const create = async () => {
    setIsCreating(true);
    try {
      await report(await host.registerPasskey(), {
        done: "Passkey created",
        failed: "That passkey wasn't created",
        description: "The attempt didn't finish. Try again, or use another way to sign in.",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const remove = async (id: string) => {
    await report(await host.removePasskey({ id }), {
      done: "Passkey removed",
      failed: "That passkey wasn't removed",
      description: "Try again in a moment.",
    });
  };

  const rename = async ({ id, name }: { id: string; name: string }) => {
    await report(await host.renamePasskey({ id, name }), {
      done: "Passkey renamed",
      failed: "That passkey wasn't renamed",
      description: "Try again in a moment.",
    });
  };

  return (
    <VStack width="full" align="start" gap={4} data-testid="passkeys-section">
      <VStack align="start" gap={1}>
        <HStack gap={2}>
          <Fingerprint size={18} />
          <Text fontWeight={600}>Passkeys</Text>
        </HStack>
        <Text color="fg.muted" fontSize="sm">
          Passkeys can be created and saved on your devices, like your phone or laptop, or on
          security keys. With passkeys on your devices, you don&apos;t need to remember complex
          passwords.
        </Text>
      </VStack>

      {isPending ? <Spinner size="sm" /> : null}

      {!isPending && held.length === 0 ? (
        <Card.Root width="full" data-testid="passkeys-empty">
          <Card.Body>
            <VStack align="start" gap={3}>
              {/* Said in terms of what somebody already does with their device,
                  because "public key credential" is not a thing anybody has ever
                  wanted. */}
              <Text fontSize="sm">
                Passkeys are encrypted digital keys you create using your fingerprint, face, or
                screen lock. They are saved in your credential manager, so you can sign in on other
                devices.
              </Text>
              <Button
                colorPalette="orange"
                loading={isCreating}
                onClick={() => void create()}
                data-testid="create-passkey"
              >
                Create a passkey
              </Button>
            </VStack>
          </Card.Body>
        </Card.Root>
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

      <RenamePasskeyDialog passkey={renaming} onClose={() => setRenaming(null)} onRename={rename} />
      <RemovePasskeyDialog passkey={removing} onClose={() => setRemoving(null)} onRemove={remove} />
    </VStack>
  );
}
