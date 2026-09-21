/**
 * Connect an AI provider on the way into the product: one row of marks, one
 * focused connect panel, and a quiet "Skip Guided Tour" link that asks once.
 */
import { Box, chakra, Flex, HStack, Text, VStack } from "@chakra-ui/react";
import { Dialog } from "@langwatch/design-system/dialog";
import { modelProviderIcons } from "@langwatch/model-provider-browser-kit";
import { EditModelProviderForm } from "@langwatch/model-provider-browser/edit-model-provider-form";
import { useEffect, useMemo, useState } from "react";
import { useAnalytics } from "react-contextual-analytics";

import { useGuidedProviderConnect } from "../../behavior/use-guided-provider-connect.ts";
import { providerSegments, SKIP_TOUR_COPY } from "../../model/copy.ts";
import { guidedProvidersFor } from "../../model/guided-providers.ts";
import { TakeoverRow } from "./takeover-row.tsx";
import { Typewriter } from "./typewriter.tsx";

export function ProviderScreen({
  picksCount,
  organizationId,
  projectId,
  fading,
  onConnected,
  onSkip,
}: {
  picksCount: number;
  organizationId: string;
  projectId: string | undefined;
  fading: boolean;
  onConnected: (connected: { provider: string; model: string }) => void;
  onSkip: () => void;
}) {
  const { emit } = useAnalytics();
  const [typed, setTyped] = useState(false);
  const providers = useMemo(() => guidedProvidersFor(), []);
  const [selectedId, setSelectedId] = useState(providers[0]?.id);
  const selected = providers.find((p) => p.id === selectedId) ?? providers[0];
  const [confirmSkip, setConfirmSkip] = useState(false);

  const { onSaved, skip } = useGuidedProviderConnect({
    organizationId,
    projectId,
    onConnected: (connected) => {
      emit("connected", "provider", { ...connected });
      onConnected(connected);
    },
  });

  useEffect(() => {
    emit("viewed", "provider");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const segments = useMemo(() => providerSegments({ picksCount }), [picksCount]);

  if (!selected) return null;

  return (
    <TakeoverRow fading={fading} maxWidth={720}>
      <Box
        minH="68px"
        fontFamily="heading"
        fontSize="24px"
        lineHeight="1.375"
        color="fg"
        data-testid="provider-line"
      >
        <Typewriter segments={segments} speed={19} onDone={() => setTyped(true)} />
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
        <Flex wrap="wrap" gap={2} aria-label="AI provider">
          {providers.map((provider) => {
            const isSelected = provider.id === selected.id;
            return (
              <chakra.button
                key={provider.id}
                type="button"
                aria-pressed={isSelected}
                aria-label={provider.name}
                title={provider.hint}
                onClick={() => {
                  setSelectedId(provider.id);
                  emit("selected", "provider", { provider: provider.id });
                }}
                display="flex"
                alignItems="center"
                gap={2}
                borderRadius="12px"
                border="1px solid"
                borderColor={isSelected ? "fg" : "border"}
                bg={isSelected ? "bg.panel" : "bg.panel/60"}
                px={3}
                py={2}
                cursor="pointer"
                transition="all 0.15s ease"
              >
                <Box w="16px" h="16px" flexShrink={0}>
                  {modelProviderIcons[provider.registryKey]}
                </Box>
                <Text fontSize="12.5px" fontWeight="500" color={isSelected ? "fg" : "fg.muted"}>
                  {provider.name}
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
          data-testid="provider-panel"
        >
          <EditModelProviderForm
            providerKey={selected.registryKey}
            modelProviderId="new"
            organizationId={organizationId}
            projectId={projectId}
            onSaved={() => void onSaved(selected)}
          />
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
          >
            {SKIP_TOUR_COPY.link}
          </chakra.button>
        </Box>
      </Box>

      <Dialog.Root
        open={confirmSkip}
        onOpenChange={(details) => setConfirmSkip(details.open)}
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
            <VStack width="full" gap={2}>
              <HStack width="full" justify="flex-end" gap={2}>
                <chakra.button
                  type="button"
                  onClick={() => {
                    emit("confirmed", "skip_tour");
                    setConfirmSkip(false);
                    void skip().then(onSkip);
                  }}
                  fontSize="13px"
                  fontWeight="500"
                  color="fg.muted"
                  px={3}
                  py={2}
                >
                  {SKIP_TOUR_COPY.skip}
                </chakra.button>
                <chakra.button
                  type="button"
                  onClick={() => {
                    emit("confirmed", "kept_guide");
                    setConfirmSkip(false);
                  }}
                  fontSize="13px"
                  fontWeight="600"
                  bg="fg"
                  color="bg.panel"
                  borderRadius="8px"
                  px={3}
                  py={2}
                >
                  {SKIP_TOUR_COPY.keep}
                </chakra.button>
              </HStack>
            </VStack>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
    </TakeoverRow>
  );
}
