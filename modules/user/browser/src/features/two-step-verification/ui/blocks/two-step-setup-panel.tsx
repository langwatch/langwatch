/**
 * The scannable code, the same value written out to type in, and the first
 * code that finishes the setup. It says the key is shown once BEFORE the
 * button that ends the chance to read it, and names nothing internal.
 */
import { Box, Button, Field, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { InputGroup } from "@langwatch/design-system/input-group";
import { Copy } from "lucide-react";
import { useState } from "react";

import { usePersonalWorkspaceHost } from "../../../../model/personal-workspace-host.ts";
import { extractSetupKey, groupSetupKey } from "../../model/setup-key.ts";
import { SetupQrCode } from "../elements/setup-qr-code.tsx";

function SetupKeyField({ setupKey }: { setupKey: string }) {
  const host = usePersonalWorkspaceHost();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(setupKey);
      host.succeeded({ title: "Setup key copied" });
    } catch (error) {
      host.failed({
        error,
        fallbackTitle: "The setup key was not copied",
        description: "Select it and copy it by hand instead.",
      });
    }
  };

  return (
    <InputGroup
      width="full"
      fontFamily="monospace"
      cursor="pointer"
      onClick={() => void copy()}
      endElement={<Copy size={16} aria-label="Copy the setup key" />}
      data-testid="two-factor-shared-secret"
    >
      <Input value={setupKey} readOnly cursor="pointer" />
    </InputGroup>
  );
}

export function TwoStepSetupPanel({
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
  const setupKey = extractSetupKey(setupUri);

  return (
    <VStack align="stretch" gap={4} width="full" data-testid="two-factor-setup">
      <Text fontSize="sm">
        Scan this with the app that makes your sign-in codes, such as 1Password, Google
        Authenticator or Authy. Then enter the code it shows you.
      </Text>

      <HStack justify="center">
        <Box
          borderWidth="1px"
          borderColor="border.muted"
          borderRadius="xl"
          padding={4}
          background="white"
          data-testid="two-factor-scannable-code"
        >
          <SetupQrCode value={setupUri} />
        </Box>
      </HStack>

      {setupKey ? (
        <VStack align="stretch" gap={1}>
          <Text fontSize="sm">If you cannot scan it, type this into the app instead:</Text>
          <SetupKeyField setupKey={setupKey} />
          <Text fontSize="xs" color="fg.muted" fontFamily="monospace">
            {groupSetupKey(setupKey)}
          </Text>
        </VStack>
      ) : null}

      <Text fontSize="sm" color="fg.muted" data-testid="two-factor-shown-once">
        This setup key is shown once. After you finish setting up, it will not be shown again. If
        you need it on another device later, you will start the setup again.
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
