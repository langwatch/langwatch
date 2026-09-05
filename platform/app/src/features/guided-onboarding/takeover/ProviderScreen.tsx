import {
  Box,
  Button,
  chakra,
  Flex,
  HStack,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Check, ChevronRight, KeyRound, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAnalytics } from "react-contextual-analytics";
import { useCodexDeviceSignIn } from "~/components/settings/useCodexDeviceSignIn";
import { useColorModeValue } from "~/components/ui/color-mode";
import { Dialog } from "~/components/ui/dialog";
import { Link } from "~/components/ui/link";
import { HEADING_FONT } from "~/features/auth-front-door/frontDoorTheme";
import { langyFirstPartyLinkProps } from "~/features/langy/hooks/useLangyExternalLinkGuard";
import type { IconData } from "~/features/onboarding/regions/shared/types";
import { CODEX_DEFAULT_MODEL } from "~/server/modelProviders/codexRestrictions";
import { api } from "~/utils/api";
import { MASKED_KEY_PLACEHOLDER } from "~/utils/constants";
import { providerSegments, SKIP_TOUR_COPY } from "./copy";
import {
  type GuidedProvider,
  guidedProviderIcon,
  guidedProvidersFor,
} from "./providers";
import { TakeoverRow } from "./TakeoverRow";
import { Typewriter } from "./Typewriter";
import {
  type GuidedConnectedProvider,
  useGuidedProviderConnect,
} from "./useGuidedProviderConnect";

/**
 * Connect an AI provider on the way into the product: one row of marks, one
 * focused connect panel. Codex signs in with the user's ChatGPT account; API
 * providers take a key with the default chat model already picked; Azure,
 * Bedrock and Custom also ask for the model name, since there is no list to
 * offer before the credentials work. Below it, a quiet "Skip Guided Tour"
 * link that asks once before letting go.
 */
export function ProviderScreen({
  picksCount,
  organizationId,
  projectId,
  codexAvailable,
  fading,
  onConnected,
  onSkip,
}: {
  picksCount: number;
  organizationId: string;
  projectId: string | undefined;
  codexAvailable: boolean;
  fading: boolean;
  onConnected: (connected: GuidedConnectedProvider) => void;
  onSkip: () => void;
}) {
  const { emit } = useAnalytics();
  const [typed, setTyped] = useState(false);
  const providers = useMemo(
    () => guidedProvidersFor({ codexAvailable }),
    [codexAvailable],
  );
  const [selectedId, setSelectedId] = useState(providers[0]?.id ?? "openai");
  const selected = providers.find((p) => p.id === selectedId) ?? providers[0]!;
  const [confirmSkip, setConfirmSkip] = useState(false);

  useEffect(() => {
    emit("viewed", "provider");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const segments = useMemo(
    () => providerSegments({ picksCount }),
    [picksCount],
  );

  const connected = (result: GuidedConnectedProvider) => {
    emit("connected", "provider", { ...result });
    onConnected(result);
  };
  const failed = (failure: { provider: string; code: string }) => {
    emit("failed", "provider", failure);
  };

  return (
    <TakeoverRow fading={fading} maxWidth={720}>
      <Box
        minH="68px"
        fontFamily={HEADING_FONT}
        fontSize="24px"
        lineHeight="1.375"
        color="fg"
        data-testid="provider-line"
      >
        <Typewriter
          segments={segments}
          speed={19}
          onDone={() => setTyped(true)}
        />
      </Box>
      <Box
        mt={6}
        w="full"
        maxW="560px"
        transition="all 0.5s ease"
        opacity={typed ? 1 : 0}
        transform={typed ? "translateY(0)" : "translateY(12px)"}
        pointerEvents={typed ? "auto" : "none"}
        aria-hidden={!typed}
        data-testid="provider-connect"
      >
        <Flex wrap="wrap" gap={2} role="radiogroup" aria-label="AI provider">
          {providers.map((p) => {
            const isSelected = p.id === selected.id;
            return (
              <chakra.button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                aria-label={p.name}
                title={p.name}
                onClick={() => {
                  setSelectedId(p.id);
                  emit("selected", "provider", { provider: p.id });
                }}
                display="flex"
                alignItems="center"
                gap={2}
                borderRadius="12px"
                border="1px solid"
                borderColor={isSelected ? "fg" : "border"}
                bg={isSelected ? "bg.panel" : "bg.panel/60"}
                boxShadow={
                  isSelected ? "0 2px 8px rgba(26, 26, 46, 0.08)" : "none"
                }
                px={3}
                py={2}
                cursor="pointer"
                transition="all 0.15s ease"
                _hover={{
                  borderColor: isSelected ? "fg" : "border.emphasized",
                }}
              >
                <ProviderMark icon={guidedProviderIcon(p)} size={16} />
                <Text
                  fontSize="12.5px"
                  fontWeight="500"
                  color={isSelected ? "fg" : "fg.muted"}
                >
                  {p.name}
                </Text>
              </chakra.button>
            );
          })}
        </Flex>

        <Box
          key={selected.id}
          mt={5}
          borderRadius="16px"
          border="1px solid"
          borderColor="border"
          bg="bg.panel"
          p={5}
          boxShadow="0 4px 20px rgba(26, 26, 46, 0.05)"
          data-testid="provider-panel"
        >
          {selected.kind === "oauth" ? (
            <CodexPanel
              provider={selected}
              organizationId={organizationId}
              projectId={projectId}
              onConnected={connected}
              onFailed={failed}
            />
          ) : (
            <CredentialsPanel
              provider={selected}
              organizationId={organizationId}
              projectId={projectId}
              onConnected={connected}
              onFailed={failed}
            />
          )}
        </Box>

        <Box mt={5} textAlign="center">
          <chakra.button
            type="button"
            onClick={() => {
              emit("clicked", "skip_tour");
              setConfirmSkip(true);
            }}
            fontSize="12.5px"
            fontWeight="500"
            color="fg.subtle"
            cursor="pointer"
            _hover={{ color: "fg.muted" }}
          >
            {SKIP_TOUR_COPY.link}
          </chakra.button>
        </Box>
      </Box>

      <Dialog.Root
        open={confirmSkip}
        onOpenChange={({ open }) => setConfirmSkip(open)}
        size="sm"
        placement="center"
      >
        <Dialog.Content maxW="400px">
          <Dialog.Header pb={1}>
            <Dialog.Title fontSize="15px" fontWeight="600">
              {SKIP_TOUR_COPY.title}
            </Dialog.Title>
          </Dialog.Header>
          <Dialog.Body pt={0}>
            <Text fontSize="12.5px" lineHeight="1.6" color="fg.muted">
              {SKIP_TOUR_COPY.body}
            </Text>
          </Dialog.Body>
          <Dialog.Footer borderTop="1px solid" borderColor="border" gap={2}>
            <Button
              variant="ghost"
              size="sm"
              color="fg.muted"
              onClick={() => {
                emit("confirmed", "skip_tour");
                setConfirmSkip(false);
                onSkip();
              }}
            >
              {SKIP_TOUR_COPY.skip}
            </Button>
            <Button
              size="sm"
              bg="fg"
              color="bg.panel"
              _hover={{ opacity: 0.9 }}
              onClick={() => {
                emit("confirmed", "kept_guide");
                setConfirmSkip(false);
              }}
            >
              {SKIP_TOUR_COPY.keep}
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
    </TakeoverRow>
  );
}

function ProviderMark({ icon, size }: { icon: IconData; size: number }) {
  const inner = icon.type === "with-label" ? icon.icon : icon;
  const src = useColorModeValue(
    inner.type === "themed" ? inner.lightSrc : inner.src,
    inner.type === "themed" ? inner.darkSrc : inner.src,
  );
  return (
    <chakra.img
      src={src}
      alt=""
      w={`${size}px`}
      h={`${size}px`}
      objectFit="contain"
      flexShrink={0}
    />
  );
}

function PanelHeader({
  provider,
  connected,
}: {
  provider: GuidedProvider;
  connected: boolean;
}) {
  return (
    <HStack gap={3} align="center">
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
        <ProviderMark icon={guidedProviderIcon(provider)} size={20} />
      </Flex>
      <Box minW={0}>
        <Text fontSize="14px" fontWeight="600" color="fg">
          {provider.name}
        </Text>
        <Text fontSize="11.5px" color="fg.muted">
          {provider.hint}
        </Text>
      </Box>
      {connected && (
        <HStack
          ml="auto"
          gap={1.5}
          fontSize="12px"
          fontWeight="500"
          color="green.fg"
        >
          <Check size={14} /> Connected
        </HStack>
      )}
    </HStack>
  );
}

function FieldLabel({ children }: { children: string }) {
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

function CredentialsPanel({
  provider,
  organizationId,
  projectId,
  onConnected,
  onFailed,
}: {
  provider: GuidedProvider;
  organizationId: string;
  projectId: string | undefined;
  onConnected: (connected: GuidedConnectedProvider) => void;
  onFailed: (failure: { provider: string; code: string }) => void;
}) {
  if (!projectId) {
    return (
      <VStack align="stretch" gap={4}>
        <PanelHeader provider={provider} connected={false} />
        <Spinner size="sm" />
      </VStack>
    );
  }
  return (
    <ConnectedCredentialsPanel
      provider={provider}
      organizationId={organizationId}
      projectId={projectId}
      onConnected={onConnected}
      onFailed={onFailed}
    />
  );
}

function ConnectedCredentialsPanel({
  provider,
  organizationId,
  projectId,
  onConnected,
  onFailed,
}: {
  provider: GuidedProvider;
  organizationId: string;
  projectId: string;
  onConnected: (connected: GuidedConnectedProvider) => void;
  onFailed: (failure: { provider: string; code: string }) => void;
}) {
  const connect = useGuidedProviderConnect({
    provider,
    projectId,
    organizationId,
    onConnected,
    onFailed,
  });
  const busy = connect.status === "checking" || connect.status === "saving";
  const isConnected = connect.status === "connected";
  const firstField = provider.fields[0]?.key;

  return (
    <VStack align="stretch" gap={4}>
      <PanelHeader provider={provider} connected={isConnected} />
      <VStack align="stretch" gap={3}>
        {provider.fields.map((field) => (
          <chakra.label key={field.key} display="block">
            <FieldLabel>{field.label}</FieldLabel>
            <Flex
              align="center"
              gap={2}
              borderRadius="12px"
              border="1px solid"
              borderColor={
                connect.error && field.key === firstField
                  ? "fg.error"
                  : "border"
              }
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
                value={connect.values[field.key] ?? ""}
                onChange={(e) => connect.setField(field.key, e.target.value)}
                placeholder={field.placeholder}
                type={field.secret ? "password" : "text"}
                autoComplete="off"
                disabled={busy || isConnected}
                w="full"
                bg="transparent"
                fontFamily="mono"
                fontSize="12.5px"
                outline="none"
                _placeholder={{ color: "fg.subtle" }}
              />
            </Flex>
            {connect.error && field.key === firstField && (
              <Text mt={1} fontSize="11.5px" color="fg.error" role="alert">
                {connect.error}
              </Text>
            )}
            {!connect.error &&
              field.secret &&
              connect.usesEnvironmentKey &&
              connect.values[field.key] === MASKED_KEY_PLACEHOLDER && (
                <Text
                  mt={1}
                  fontSize="11px"
                  color="fg.muted"
                  data-testid="environment-key-hint"
                >
                  This server already has a key for {provider.name}. Connect to
                  use it, or paste your own.
                </Text>
              )}
          </chakra.label>
        ))}

        {provider.kind === "manual" ? (
          <chakra.label display="block">
            <FieldLabel>Chat model</FieldLabel>
            <chakra.input
              aria-label="Chat model"
              value={connect.manualModel}
              onChange={(e) => connect.setManualModel(e.target.value)}
              placeholder={provider.modelPlaceholder}
              disabled={busy || isConnected}
              w="full"
              borderRadius="12px"
              border="1px solid"
              borderColor="border"
              bg="bg.page"
              px={3}
              py={2.5}
              fontFamily="mono"
              fontSize="12.5px"
              outline="none"
              _placeholder={{ color: "fg.subtle" }}
              _focus={{ borderColor: "border.emphasized" }}
            />
            <Text
              as="span"
              display="block"
              mt={1}
              fontSize="11px"
              color="fg.subtle"
            >
              Type it exactly as deployed: {provider.name} has no model list we
              can read for you.
            </Text>
          </chakra.label>
        ) : (
          <Box>
            <FieldLabel>Default chat model</FieldLabel>
            <Flex
              wrap="wrap"
              gap={1.5}
              role="radiogroup"
              aria-label="Default chat model"
            >
              {connect.models.map((m, i) => {
                const picked = m === connect.model;
                return (
                  <chakra.button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={picked}
                    onClick={() => connect.setModel(m)}
                    disabled={busy || isConnected}
                    display="flex"
                    alignItems="center"
                    gap={1.5}
                    borderRadius="full"
                    border="1px solid"
                    borderColor={picked ? "fg" : "border"}
                    bg={picked ? "bg.muted" : "transparent"}
                    color={picked ? "fg" : "fg.muted"}
                    fontFamily="mono"
                    fontSize="11.5px"
                    fontWeight={picked ? "600" : "400"}
                    px={2.5}
                    py={1}
                    cursor="pointer"
                    _hover={{
                      borderColor: picked
                        ? "frontDoor.action"
                        : "border.emphasized",
                    }}
                  >
                    {picked && <Sparkles size={11} />}
                    {m}
                    {i === 0 && picked && (
                      <Text
                        as="span"
                        fontFamily="body"
                        fontSize="9.5px"
                        fontWeight="500"
                        opacity={0.7}
                      >
                        recommended
                      </Text>
                    )}
                  </chakra.button>
                );
              })}
            </Flex>
          </Box>
        )}

        <Button
          onClick={() => void connect.connect()}
          disabled={!connect.ready && !busy && !isConnected}
          w="full"
          h="44px"
          borderRadius="12px"
          fontSize="13.5px"
          fontWeight="600"
          gap={2}
          bg={connect.ready || busy || isConnected ? "fg" : "bg.muted"}
          color={
            connect.ready || busy || isConnected ? "bg.panel" : "fg.subtle"
          }
          _hover={{ opacity: 0.9 }}
          _disabled={{ cursor: "not-allowed", opacity: 1 }}
        >
          {busy && <Spinner size="xs" />}
          {isConnected ? "Connected" : busy ? "Checking the key…" : "Connect"}
          {!busy && !isConnected && <ChevronRight size={15} />}
        </Button>
      </VStack>
    </VStack>
  );
}

function CodexPanel({
  provider,
  organizationId,
  projectId,
  onConnected,
  onFailed,
}: {
  provider: GuidedProvider;
  organizationId: string;
  projectId: string | undefined;
  onConnected: (connected: GuidedConnectedProvider) => void;
  onFailed: (failure: { provider: string; code: string }) => void;
}) {
  const recordProvider = api.onboarding.recordProvider.useMutation();
  const signIn = useCodexDeviceSignIn({
    projectId: projectId ?? "",
    scopes: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
    setAsCodingDefaults: true,
    onConnected: () => {
      recordProvider.mutate(
        {
          organizationId,
          provider: "openai_codex",
          model: CODEX_DEFAULT_MODEL,
        },
        {
          onSettled: () =>
            onConnected({
              provider: "openai_codex",
              model: CODEX_DEFAULT_MODEL,
              kind: "oauth",
            }),
        },
      );
    },
  });
  const { phase } = signIn;
  const timedOut = phase.name === "error" && phase.timedOut;
  useEffect(() => {
    if (phase.name === "error") {
      onFailed({
        provider: "openai_codex",
        code: phase.timedOut
          ? "codex_sign_in_timed_out"
          : "codex_sign_in_failed",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.name, timedOut]);

  const waiting = phase.name === "starting" || phase.name === "pending";
  const isConnected = phase.name === "complete";

  return (
    <VStack align="stretch" gap={4}>
      <PanelHeader provider={provider} connected={isConnected} />
      {phase.name === "error" && (
        <Text fontSize="11.5px" color="fg.error" role="alert">
          {phase.message}
        </Text>
      )}
      <Button
        onClick={() => void signIn.begin()}
        disabled={waiting || isConnected || !projectId}
        w="full"
        h="44px"
        borderRadius="12px"
        fontSize="13.5px"
        fontWeight="600"
        gap={2.5}
        bg="fg"
        color="bg.panel"
        _hover={{ opacity: 0.9 }}
        _disabled={{ opacity: 0.7, cursor: "not-allowed" }}
      >
        {waiting ? (
          <Spinner size="xs" />
        ) : (
          <chakra.img
            src="/images/external-icons/openai-darktheme.svg"
            alt=""
            w="16px"
            h="16px"
          />
        )}
        {isConnected
          ? "Signed in"
          : waiting
            ? "Waiting for ChatGPT…"
            : "Sign in with ChatGPT"}
      </Button>
      {phase.name === "pending" && (
        <VStack align="stretch" gap={2} data-testid="codex-pending">
          <Text fontSize="12.5px" color="fg.muted">
            Enter this code on OpenAI's device page to approve the sign-in:
          </Text>
          <HStack justify="space-between" gap={3} wrap="wrap">
            <Text
              fontSize="2xl"
              fontWeight="700"
              fontFamily="mono"
              letterSpacing="0.12em"
              aria-label="One-time sign-in code"
            >
              {phase.userCode}
            </Text>
            <Button asChild size="sm" colorPalette="orange">
              <Link
                href={phase.verificationUrl}
                isExternal
                color="white"
                _hover={{ textDecoration: "none", color: "white" }}
                {...langyFirstPartyLinkProps}
              >
                Open openai.com
              </Link>
            </Button>
          </HStack>
          <Button
            size="2xs"
            variant="ghost"
            alignSelf="flex-start"
            onClick={signIn.cancel}
          >
            Cancel
          </Button>
        </VStack>
      )}
    </VStack>
  );
}
