import {
  Box,
  Button,
  Card,
  HStack,
  IconButton,
  Spacer,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Fingerprint, Trash2, Usb } from "lucide-react";
import { useState } from "react";

import { toaster } from "~/components/ui/toaster";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { authClient } from "~/utils/auth-client";

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
 * One group of cards under a heading it earns. Renders nothing when empty:
 * "Passkeys on security keys (0)" is a heading about an absence, and the
 * page is not a report.
 */
function PasskeyGroup({
  heading,
  passkeys,
  onRemove,
}: {
  heading: string;
  passkeys: HeldPasskey[];
  onRemove: (id: string) => Promise<void>;
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
        <Card.Root key={passkey.id} width="full" data-testid="passkey-card">
          <Card.Body paddingY={3}>
            <HStack>
              <Box color="fg.muted" display="flex">
                {isSecurityKey(passkey) ? (
                  <Usb size={16} />
                ) : (
                  <Fingerprint size={16} />
                )}
              </Box>
              <VStack align="start" gap={0}>
                <Text fontSize="sm" fontWeight={500}>
                  {passkey.name ?? "Passkey"}
                </Text>
                <Text fontSize="xs" color="fg.muted">
                  Added {new Date(passkey.createdAt).toLocaleDateString()}
                </Text>
              </VStack>
              <Spacer />
              <IconButton
                variant="ghost"
                size="sm"
                aria-label="Remove this passkey"
                onClick={() => void onRemove(passkey.id)}
              >
                <Trash2 size={16} />
              </IconButton>
            </HStack>
          </Card.Body>
        </Card.Root>
      ))}
    </VStack>
  );
}

/**
 * Creating, seeing and removing passkeys, in the one place somebody goes
 * looking for them (Passkey Central, "Create, view and manage passkeys in
 * account settings").
 *
 * It sits ABOVE the password section on purpose. The order of a settings page
 * is an argument about what the account should be secured with, and putting
 * the thing we would rather people used underneath the thing we would rather
 * they stopped using makes the opposite one.
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

  // A deployment that never mounted the plugin has no endpoint behind any of
  // this. Rendering the hero there would be an offer we cannot honour.
  if (publicEnv.data?.PASSKEYS_ENABLED !== true) return null;

  const held = passkeys.data ?? [];

  const create = async () => {
    setIsCreating(true);
    try {
      const result = await authClient.passkey.addPasskey({});
      // A cancelled prompt is not a failure. Somebody opened the OS dialog,
      // looked at it and closed it; saying "something went wrong" about a
      // decision would be telling them off for deciding.
      if (result?.error) {
        if (result.error.status !== 0) {
          toaster.error({
            title: "That passkey wasn't created",
            description:
              "The attempt didn't finish. Try again, or use another way to sign in.",
          });
        }
        return;
      }
      toaster.success({ title: "Passkey created" });
    } catch {
      toaster.error({
        title: "That passkey wasn't created",
        description: "This device could not complete the attempt.",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await authClient.passkey.deletePasskey({ id });
      toaster.success({ title: "Passkey removed" });
    } catch {
      toaster.error({
        title: "That passkey wasn't removed",
        description: "Try again in a moment.",
      });
    }
  };

  return (
    <VStack width="full" align="start" gap={4} data-testid="passkeys-section">
      <VStack align="start" gap={1}>
        <HStack gap={2}>
          <Fingerprint size={18} />
          <Text fontWeight={600}>Passkeys</Text>
        </HStack>
        <Text color="fg.muted" fontSize="sm">
          Passkeys can be created and saved on your devices, like your phone or
          laptop, or on security keys. With passkeys on your devices, you don't
          need to remember complex passwords.
        </Text>
      </VStack>

      {passkeys.isPending ? <Spinner size="sm" /> : null}

      {!passkeys.isPending && held.length === 0 ? (
        <Card.Root width="full" data-testid="passkeys-empty">
          <Card.Body>
            <VStack align="start" gap={3}>
              {/* Said in terms of what somebody already does with their
                  device, because "public key credential" is not a thing
                  anybody has ever wanted. */}
              <Text fontSize="sm">
                Passkeys are encrypted digital keys you create using your
                fingerprint, face, or screen lock. They are saved in your
                credential manager, so you can sign in on other devices.
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
            onRemove={remove}
          />
          <PasskeyGroup
            heading="Passkeys on security keys"
            passkeys={held.filter(isSecurityKey)}
            onRemove={remove}
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
    </VStack>
  );
}
