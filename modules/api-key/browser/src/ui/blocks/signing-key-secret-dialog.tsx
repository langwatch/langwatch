/**
 * A signing key's secret, shown once after create or rotate, with setup snippets per SDK.
 * The secret lives only in the caller's state and is dropped when this closes.
 * Spec: modules/api-key/specs/signing-keys.feature
 */
import { type SnippetCopy, SnippetPreview } from "@langwatch/design-system/code-preview";
import { ContentTabs } from "@langwatch/design-system/content-tabs";
import { Dialog } from "@langwatch/design-system/dialog";
import { InlineCode } from "@langwatch/design-system/inline-code";
import {
  Alert,
  Box,
  Button,
  HStack,
  IconButton,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { Clipboard, Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import {
  maskSigningKey,
  SIGNING_KEY_ENV,
  SIGNING_KEY_SNIPPETS,
  type SigningKeyLanguage,
} from "../../model/signing-key-setup.ts";

/** What create or rotate answered, held by the panel until the dialog closes. */
export type IssuedSecret = Readonly<{ name: string; secret: string; rotated: boolean }>;

function SecretBody({ issued, copy }: { issued: IssuedSecret; copy: SnippetCopy }) {
  const [revealed, setRevealed] = useState(false);
  const [language, setLanguage] = useState<SigningKeyLanguage>("typescript");
  return (
    <VStack gap={5} align="stretch">
      <VStack gap={2} align="stretch">
        <Text textStyle="sm" fontWeight="semibold">
          Store the key as <InlineCode>{SIGNING_KEY_ENV}</InlineCode> in the project that makes the
          calls
        </Text>
        <HStack gap={2} flexWrap="wrap">
          <Box flex="1 1 12rem" minWidth={0}>
            <InlineCode
              variant="neutral"
              data-testid="signing-key-secret"
              height="auto"
              whiteSpace="normal"
              wordBreak="break-all"
            >
              {revealed ? issued.secret : maskSigningKey(issued.secret)}
            </InlineCode>
          </Box>
          <IconButton
            size="xs"
            variant="ghost"
            aria-label={revealed ? "Hide signing key" : "Show signing key"}
            aria-pressed={revealed}
            onClick={() => setRevealed(!revealed)}
          >
            {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
          </IconButton>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void copy({ text: issued.secret, what: "Signing key" })}
          >
            <Clipboard size={14} />
            Copy key
          </Button>
        </HStack>
      </VStack>

      <Alert.Root status="warning" size="sm">
        <Alert.Indicator />
        <Alert.Title>
          Copy this key now. You won&apos;t be able to see it again, and anyone who has it can sign
          as this project.
        </Alert.Title>
      </Alert.Root>

      <VStack as="section" aria-label="Set up your SDK" gap={2} align="stretch">
        <Text textStyle="sm" fontWeight="semibold">
          Sign the calls this project makes, and copy the tag in the projects it calls
        </Text>
        <ContentTabs<SigningKeyLanguage>
          label="SDK language"
          value={language}
          onValueChange={({ value }) => setLanguage(value)}
          body="flush"
          mount="active"
          items={SIGNING_KEY_SNIPPETS.map((snippet) => ({
            value: snippet.language,
            label: snippet.label,
            testId: `signing-key-snippet-${snippet.language}`,
            content: (
              <Box paddingTop={3}>
                <SnippetPreview
                  copy={copy}
                  code={snippet.code}
                  copyText={snippet.code}
                  filename={snippet.filename}
                  codeLanguage={snippet.codeLanguage}
                />
              </Box>
            ),
          }))}
        />
        <Text textStyle="caption" color="fg.muted">
          Deploy, then check this list: signed spans show under the key within a minute, and failed
          signatures show there too.
        </Text>
      </VStack>
    </VStack>
  );
}

export function SigningKeySecretDialog({
  issued,
  copy,
  onClose,
}: {
  issued: IssuedSecret | null;
  copy: SnippetCopy;
  onClose: () => void;
}) {
  const title = issued?.rotated
    ? `"${issued.name}" was rotated`
    : `"${issued?.name ?? ""}" is ready`;
  return (
    <Dialog
      open={!!issued}
      onClose={onClose}
      title={title}
      size="lg"
      cancelLabel={null}
      closeOnInteractOutside={false}
      primaryAction={{
        label: "I've stored the key",
        onClick: onClose,
        "data-testid": "signing-key-secret-done",
      }}
      data-testid="signing-key-secret-dialog"
    >
      {issued && <SecretBody key={issued.secret} issued={issued} copy={copy} />}
    </Dialog>
  );
}
