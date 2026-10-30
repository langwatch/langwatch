import { Checkbox } from "@langwatch/design-system/checkbox";
import {
  Box,
  Button,
  Field,
  HStack,
  Input,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";

import { CopyButton } from "./http-test-components.tsx";

export type HttpHooksConfigSectionProps = {
  hooksUrl: string;
  onHooksUrlChange: (value: string) => void;
  hooks: { setup: boolean; teardown: boolean };
  onHooksChange: (hooks: { setup: boolean; teardown: boolean }) => void;
  /** A secret made in this session, shown until the drawer closes. */
  newSigningSecret: string | null;
  hasStoredSigningSecret: boolean;
  onRotateSigningSecret: () => void;
};

/** The hooks URL a scenario run calls before and after its turns (ADR-188). */
export function HooksConfigSection({
  hooksUrl,
  onHooksUrlChange,
  hooks,
  onHooksChange,
  newSigningSecret,
  hasStoredSigningSecret,
  onRotateSigningSecret,
}: HttpHooksConfigSectionProps) {
  const hasUrl = hooksUrl.trim() !== "";

  return (
    <VStack gap={4} align="stretch">
      <Text fontSize="sm" color="fg.muted">
        A scenario run POSTs setup to this URL before its turns and teardown after them, so you can
        make and remove test data. Leave it empty for no hooks.
      </Text>
      <Field.Root>
        <Field.Label>Hooks URL</Field.Label>
        <Input
          value={hooksUrl}
          onChange={(event) => onHooksUrlChange(event.target.value)}
          placeholder="https://api.example.com/scenario-hooks"
          data-testid="hooks-url-input"
        />
      </Field.Root>
      <HStack gap={6}>
        <Checkbox
          checked={hooks.setup}
          disabled={!hasUrl}
          onChange={() => onHooksChange({ ...hooks, setup: !hooks.setup })}
        >
          Call setup
        </Checkbox>
        <Checkbox
          checked={hooks.teardown}
          disabled={!hasUrl}
          onChange={() => onHooksChange({ ...hooks, teardown: !hooks.teardown })}
        >
          Call teardown
        </Checkbox>
      </HStack>
      <SigningSecret
        hasUrl={hasUrl}
        newSigningSecret={newSigningSecret}
        hasStoredSigningSecret={hasStoredSigningSecret}
        onRotate={onRotateSigningSecret}
      />
    </VStack>
  );
}

function SigningSecret({
  hasUrl,
  newSigningSecret,
  hasStoredSigningSecret,
  onRotate,
}: {
  hasUrl: boolean;
  newSigningSecret: string | null;
  hasStoredSigningSecret: boolean;
  onRotate: () => void;
}) {
  if (!hasUrl && !hasStoredSigningSecret) return null;

  return (
    <Field.Root>
      <Field.Label>Signing secret</Field.Label>
      <Text fontSize="sm" color="fg.muted">
        Every hook call carries X-LangWatch-Signature, an HMAC-SHA256 of the timestamp and the body
        made with this secret. Check it before you change any data.
      </Text>
      {newSigningSecret ? (
        <Box data-testid="hooks-new-signing-secret" marginTop={2}>
          <HStack gap={1}>
            <Text textStyle="mono" fontSize="sm" wordBreak="break-all">
              {newSigningSecret}
            </Text>
            <CopyButton text={newSigningSecret} label="Copy signing secret" />
          </HStack>
          <Text fontSize="sm" color="fg.warning">
            Copy it now. You will not see it again after you save.
          </Text>
        </Box>
      ) : (
        <Text fontSize="sm" marginTop={2} data-testid="hooks-stored-signing-secret">
          A signing secret is set.
        </Text>
      )}
      <Button
        size="xs"
        variant="outline"
        marginTop={2}
        alignSelf="flex-start"
        onClick={onRotate}
        disabled={!hasUrl}
        data-testid="rotate-signing-secret-button"
      >
        Rotate
      </Button>
      <Text fontSize="sm" color="fg.muted" marginTop={1}>
        The old secret stops working when you save. Update your receiver at the same time.
      </Text>
    </Field.Root>
  );
}
