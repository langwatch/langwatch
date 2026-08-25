import {
  Box,
  Heading,
  HStack,
  IconButton,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { SelfServeSetupView } from "@langwatch/identity-server";
import { Copy } from "lucide-react";
import { toaster } from "../../ui/toaster";

/**
 * What LangWatch is, to somebody about to configure their identity provider
 * (D09).
 *
 * BEFORE a single field is asked for, because the order is the order the work
 * happens in: an administrator sets an application up in their identity
 * provider, and to do that they need these values. A form that only asked
 * them questions would send them away to guess, and the values they would
 * guess are ours.
 *
 * ONLY the chosen protocol's values. OpenID Connect needs one address and
 * SAML needs three, and a screen that showed all four regardless read as a
 * wall of URLs where every reader had to work out which lines were theirs.
 * The protocol choice above this section is what scopes it.
 */
export function ServiceProviderDetails({
  serviceProvider,
  connected,
  protocol,
}: {
  serviceProvider: SelfServeSetupView["serviceProvider"];
  connected: boolean;
  protocol: "oidc" | "saml";
}) {
  const rows =
    protocol === "oidc"
      ? [
          {
            label: "Redirect address",
            hint: "Where your identity provider sends people back to",
            value: serviceProvider.redirectUrl,
          },
        ]
      : [
          {
            label: "Assertion address",
            hint: "Where your identity provider posts the signed assertion",
            value: serviceProvider.assertionConsumerServiceUrl,
          },
          {
            label: "Entity id",
            hint: "What to call LangWatch in your identity provider",
            value: serviceProvider.entityId,
          },
          {
            label: "Service provider metadata",
            hint: "Import this address if your identity provider takes one",
            value: serviceProvider.metadataUrl,
          },
        ];

  return (
    <VStack align="stretch" gap={3}>
      <VStack align="stretch" gap={1}>
        <Heading size="sm">Set LangWatch up in your identity provider</Heading>
        <Text color="fg.muted" fontSize="sm">
          {rows.length === 1
            ? "Create an application there and give it this address. It is ours and it does not change."
            : "Create an application there and give it these values. They are ours and they do not change."}
          {!connected && (
            <>
              {" "}
              The part shown as <code>{"{connection}"}</code> is filled in once
              you register below, so come back for the finished{" "}
              {rows.length === 1 ? "address" : "addresses"}.
            </>
          )}
        </Text>
      </VStack>
      <Box
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="lg"
        overflow="hidden"
      >
        {rows.map((row, index) => (
          <ServiceProviderValueRow
            key={row.label}
            label={row.label}
            hint={row.hint}
            value={row.value}
            first={index === 0}
          />
        ))}
      </Box>
    </VStack>
  );
}

function ServiceProviderValueRow({
  label,
  hint,
  value,
  first,
}: {
  label: string;
  hint: string;
  value: string;
  first: boolean;
}) {
  const copy = () => {
    if (!navigator.clipboard) {
      toaster.create({
        title: `Your browser does not support clipboard access, please copy the ${label} manually`,
        type: "error",
        duration: 2000,
      });
      return;
    }
    void navigator.clipboard.writeText(value).then(() => {
      toaster.create({
        title: `${label} copied to your clipboard`,
        type: "success",
        duration: 2000,
      });
    });
  };

  return (
    <HStack
      gap={3}
      paddingX={3.5}
      paddingY={2.5}
      borderTopWidth={first ? 0 : "1px"}
      borderColor="border.muted"
      cursor="pointer"
      _hover={{ backgroundColor: "bg.subtle" }}
      onClick={copy}
    >
      <VStack align="stretch" gap={0.5} minWidth={0} flex="1">
        <HStack gap={2}>
          <Text fontSize="sm" fontWeight="medium">
            {label}
          </Text>
          <Text fontSize="xs" color="fg.muted">
            {hint}
          </Text>
        </HStack>
        <Text
          fontFamily="mono"
          fontSize="xs"
          color="fg.muted"
          truncate
          title={value}
        >
          {value}
        </Text>
      </VStack>
      <IconButton
        aria-label={`Copy ${label}`}
        size="xs"
        variant="ghost"
        flexShrink={0}
        onClick={(event) => {
          event.stopPropagation();
          copy();
        }}
      >
        <Copy size={14} />
      </IconButton>
    </HStack>
  );
}
