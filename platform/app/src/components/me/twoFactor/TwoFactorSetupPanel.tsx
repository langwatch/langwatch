import {
  Box,
  Button,
  Field,
  HStack,
  Input,
  QrCode,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useState } from "react";
import { CopyInput } from "~/components/CopyInput";
import { groupedSecret, sharedSecretFrom } from "./totpUri";

/**
 * The screen that sets two-step verification up: the scannable code, the same
 * value written out to type in, and the first code that finishes it.
 *
 * The two halves are the same secret, read out of the one setup link, so
 * there is no way for the square somebody scans and the characters somebody
 * types to disagree.
 *
 * It says the secret will not be shown again, in as many words and BEFORE the
 * button that finishes the setup. That sentence is the whole reason this
 * screen is a step rather than a panel somebody can wander back to: once the
 * setup is confirmed there is nothing left to show, and a person who assumed
 * otherwise finds that out at the worst possible moment — on a new phone,
 * with no way in.
 *
 * Nothing on it names anything internal. No table, no service, no plugin, and
 * no initialisms: "the app that makes your codes", not a category name.
 */
export function TwoFactorSetupPanel({
  setupUri,
  isConfirming,
  onConfirm,
  onCancel,
}: {
  setupUri: string;
  isConfirming: boolean;
  onConfirm: (code: string) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState("");
  const secret = sharedSecretFrom(setupUri);

  return (
    <VStack align="stretch" gap={4} width="full" data-testid="two-factor-setup">
      <Text fontSize="sm">
        Scan this with the app that makes your sign-in codes, such as 1Password,
        Google Authenticator or Authy. Then enter the code it shows you.
      </Text>

      <HStack justify="center">
        <Box
          borderWidth="1px"
          borderRadius="md"
          padding={4}
          background="white"
          data-testid="two-factor-scannable-code"
        >
          <QrCode.Root value={setupUri} size="lg">
            <QrCode.Frame>
              <QrCode.Pattern />
            </QrCode.Frame>
          </QrCode.Root>
        </Box>
      </HStack>

      {secret ? (
        <VStack align="stretch" gap={1}>
          <Text fontSize="sm">
            If you cannot scan it, type this into the app instead:
          </Text>
          <CopyInput
            value={secret}
            label="setup key"
            data-testid="two-factor-shared-secret"
          />
          <Text fontSize="xs" color="fg.muted" fontFamily="monospace">
            {groupedSecret(secret)}
          </Text>
        </VStack>
      ) : null}

      {/* Said before the button that ends the chance to read it, not after. */}
      <Text fontSize="sm" color="fg.muted" data-testid="two-factor-shown-once">
        This setup key is shown once. After you finish setting up, it will not
        be shown again — if you need it on another device later, you will start
        the setup again.
      </Text>

      <Field.Root>
        <Field.Label>Enter the code from your app</Field.Label>
        <Input
          value={code}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
          onChange={(event) => setCode(event.target.value.trim())}
          data-testid="two-factor-code"
        />
      </Field.Root>

      <HStack gap={3} justify="end">
        <Button variant="outline" onClick={onCancel} disabled={isConfirming}>
          Cancel
        </Button>
        <Button
          colorPalette="orange"
          loading={isConfirming}
          disabled={code.length === 0}
          onClick={() => onConfirm(code)}
          data-testid="confirm-two-factor"
        >
          Finish setting up
        </Button>
      </HStack>
    </VStack>
  );
}
