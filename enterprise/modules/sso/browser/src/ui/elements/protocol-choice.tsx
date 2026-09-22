// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * How this connection talks, asked in what the administrator is holding
 * rather than in protocol names: a client id and a secret, or a metadata
 * file. A provider tile pre-answers it, so these cards stay on screen after
 * one is picked — pre-answered must never mean hidden.
 */
import { Box, HStack, Text, VStack, chakra } from "@chakra-ui/react";
import { FileCode2, KeyRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { SsoProtocol } from "../../model/identity-providers.ts";

const CHOICES: {
  value: SsoProtocol;
  title: string;
  description: string;
  icon: LucideIcon;
}[] = [
  {
    value: "oidc",
    title: "OpenID Connect",
    description: "You have a client id and a client secret.",
    icon: KeyRound,
  },
  {
    value: "saml",
    title: "SAML",
    description: "You have a metadata file, or a sign-in address and a certificate.",
    icon: FileCode2,
  },
];

export function ProtocolChoice({
  value,
  onChange,
}: {
  value: SsoProtocol;
  onChange: (protocol: SsoProtocol) => void;
}) {
  return (
    <HStack align="stretch" gap={2} width="full" data-testid="sso-protocol-choice">
      {CHOICES.map((choice) => (
        <ProtocolCard
          key={choice.value}
          choice={choice}
          selected={choice.value === value}
          onPick={() => onChange(choice.value)}
        />
      ))}
    </HStack>
  );
}

function ProtocolCard({
  choice,
  selected,
  onPick,
}: {
  choice: (typeof CHOICES)[number];
  selected: boolean;
  onPick: () => void;
}) {
  const Icon = choice.icon;

  return (
    <chakra.button
      type="button"
      // `jsx-a11y(prefer-tag-over-role)` refuses `role="radio"` on a button,
      // and nothing suppresses it, so the card says it is pressed instead.
      aria-pressed={selected}
      onClick={onPick}
      colorPalette="orange"
      flex="1"
      display="flex"
      alignItems="flex-start"
      gap={3}
      padding={3}
      borderWidth="1px"
      borderColor={selected ? "colorPalette.solid" : "border.emphasized"}
      borderRadius="lg"
      background={selected ? "colorPalette.subtle" : "bg.panel"}
      cursor="pointer"
      textAlign="left"
      transition="all 0.15s ease"
      _hover={{ borderColor: selected ? "colorPalette.solid" : "border" }}
      data-testid={`sso-protocol-${choice.value}`}
    >
      <Box color={selected ? "colorPalette.fg" : "fg.muted"} paddingTop={0.5}>
        <Icon size={16} aria-hidden="true" />
      </Box>
      <VStack align="start" gap={0.5}>
        <Text fontSize="sm" fontWeight="medium">
          {choice.title}
        </Text>
        <Text color="fg.muted" fontSize="xs">
          {choice.description}
        </Text>
      </VStack>
    </chakra.button>
  );
}
