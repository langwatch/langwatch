import {
  Box,
  Button,
  chakra,
  Flex,
  HStack,
  Spinner,
  Text,
} from "@langwatch/design-system/primitives";
import { modelProviderIcons } from "@langwatch/design-system/provider-icons";
import { Check, ChevronRight, KeyRound } from "lucide-react";
import type { ReactNode } from "react";

import type {
  GuidedCredentialField,
  GuidedPanelSpec,
} from "../../model/guided-credential-fields.ts";

/** A provider's mark at a fixed size; providers without one render nothing. */
export function GuidedProviderMark({ providerKey, size }: { providerKey: string; size: number }) {
  const icon = (modelProviderIcons as Record<string, ReactNode>)[providerKey];
  if (!icon) return null;
  return (
    <Box
      w={`${size}px`}
      h={`${size}px`}
      flexShrink={0}
      css={{ "& > svg": { w: "full", h: "full" } }}
    >
      {icon}
    </Box>
  );
}

/** The panel's title row: the mark in a rounded tile, name, hint, and Connected once it is. */
export function GuidedPanelHeader({
  providerKey,
  spec,
  connected,
}: {
  providerKey: string;
  spec: GuidedPanelSpec;
  connected: boolean;
}) {
  return (
    <HStack gap={3} align="center" width="full">
      <Flex
        w="36px"
        h="36px"
        align="center"
        justify="center"
        borderRadius="12px"
        border="1px solid"
        borderColor="border"
        bg="bg.page"
        flexShrink={0}
      >
        <GuidedProviderMark providerKey={providerKey} size={20} />
      </Flex>
      <Box minW={0}>
        <Text fontSize="14px" fontWeight="600" color="fg">
          {spec.name}
        </Text>
        <Text fontSize="11.5px" color="fg.muted">
          {spec.hint}
        </Text>
      </Box>
      {connected && (
        <HStack ml="auto" gap={1.5} fontSize="12px" fontWeight="500" color="green.fg">
          <Check size={14} /> Connected
        </HStack>
      )}
    </HStack>
  );
}

export function GuidedFieldLabel({ children }: { children: string }) {
  return (
    <Text
      as="span"
      display="block"
      mb={1}
      fontSize="11px"
      fontWeight="600"
      letterSpacing="0.04em"
      textTransform="uppercase"
      color="fg.subtle"
    >
      {children}
    </Text>
  );
}

/** One credential row: label, key icon and a mono input; error or server-key hint below. */
function GuidedCredentialInput({
  field,
  value,
  error,
  hint,
  disabled,
  onChange,
}: {
  field: GuidedCredentialField;
  value: string;
  error: string | undefined;
  hint: ReactNode;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <chakra.label display="block">
      <GuidedFieldLabel>{field.label}</GuidedFieldLabel>
      <Flex
        align="center"
        gap={2}
        borderRadius="12px"
        border="1px solid"
        borderColor={error ? "fg.error" : "border"}
        bg="bg.page"
        px={3}
        py={2.5}
        _focusWithin={{ borderColor: "border.emphasized" }}
      >
        <Box color="fg.subtle" flexShrink={0}>
          <KeyRound size={14} />
        </Box>
        <chakra.input
          aria-label={field.label}
          data-testid={`model-provider-credential-${field.key}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          type={field.secret ? "password" : "text"}
          autoComplete="off"
          disabled={disabled}
          w="full"
          bg="transparent"
          fontFamily="mono"
          fontSize="12.5px"
          outline="none"
          _placeholder={{ color: "fg.subtle" }}
        />
      </Flex>
      {error ? (
        <Text mt={1} fontSize="11.5px" color="fg.error" role="alert">
          {error}
        </Text>
      ) : (
        hint
      )}
    </chakra.label>
  );
}

/** The provider's guided credentials; a refused key reads under the first field, as main had it. */
export function GuidedCredentialFields({
  spec,
  values,
  fieldErrors,
  refusal,
  serverKeyHint,
  disabled,
  onChange,
}: {
  spec: GuidedPanelSpec;
  values: Record<string, string>;
  fieldErrors: Record<string, string>;
  refusal: string | undefined;
  serverKeyHint: ReactNode;
  disabled: boolean;
  onChange: (key: string, value: string) => void;
}) {
  const firstSecret = spec.fields.find((field) => field.secret)?.key;
  return (
    <>
      {spec.fields.map((field, index) => (
        <GuidedCredentialInput
          key={field.key}
          field={field}
          value={values[field.key] ?? ""}
          error={fieldErrors[field.key] ?? (index === 0 ? refusal : undefined)}
          hint={field.key === firstSecret ? serverKeyHint : null}
          disabled={disabled}
          onChange={(value) => onChange(field.key, value)}
        />
      ))}
    </>
  );
}

/** Tells the guided reader the server's own key is in use until they paste one. */
export function GuidedServerKeyHint({ providerName }: { providerName: string }) {
  return (
    <Text mt={1} fontSize="11px" color="fg.muted" data-testid="environment-key-hint">
      This server already has a key for {providerName}. Connect to use it, or paste your own.
    </Text>
  );
}

function connectLabel({
  connected,
  busy,
  label,
}: {
  connected: boolean;
  busy: boolean;
  label: string;
}): string {
  if (connected) return "Connected";
  return busy ? "Checking the key…" : label;
}

/** Full-width Connect: dark once there is something to connect, quiet until then. */
export function GuidedConnectButton({
  ready,
  busy,
  connected,
  label,
  onConnect,
}: {
  ready: boolean;
  busy: boolean;
  connected: boolean;
  label: string;
  onConnect: () => void;
}) {
  const lit = ready || busy || connected;
  return (
    <Button
      onClick={onConnect}
      disabled={!ready || busy || connected}
      data-testid="model-provider-save"
      w="full"
      h="44px"
      borderRadius="12px"
      fontSize="13.5px"
      fontWeight="600"
      gap={2}
      bg={lit ? "fg" : "bg.muted"}
      color={lit ? "bg.panel" : "fg.subtle"}
      _hover={{ opacity: 0.9 }}
      _disabled={{ cursor: "not-allowed", opacity: 1 }}
    >
      {busy && <Spinner size="xs" />}
      {connectLabel({ connected, busy, label })}
      {!busy && !connected && <ChevronRight size={15} />}
    </Button>
  );
}
