import { Card } from "@langwatch/design-system/card";
import { Dialog } from "@langwatch/design-system/dialog";
/**
 * Connect an AI provider on the way into the product: one row of marks, one
 * focused connect panel, and a quiet "Skip Guided Tour" link that asks once.
 */
import { Box, chakra, Flex, Text } from "@langwatch/design-system/primitives";
import { modelProviderIcons } from "@langwatch/design-system/provider-icons";
import { EditModelProviderForm as LentEditModelProviderForm } from "@langwatch/model-provider-client";
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
  onSkipFailed,
}: {
  picksCount: number;
  organizationId: string;
  projectId: string | undefined;
  fading: boolean;
  onConnected: (connected: { provider: string; model: string }) => void;
  onSkip: () => void;
  /** The skip could not be recorded; the reader stays on this screen. */
  onSkipFailed?: (error: unknown) => void;
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
      const kind = providers.find((p) => p.registryKey === connected.provider)?.kind;
      emit("connected", "provider", { ...connected, kind });
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
      <Box minH="68px" textStyle="takeoverPrompt" color="fg" data-testid="provider-line">
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
        <Flex as="fieldset" wrap="wrap" gap={2} aria-label="AI provider">
          {providers.map((provider) => {
            const isSelected = provider.id === selected.id;
            return (
              <chakra.button
                key={provider.id}
                type="button"
                aria-pressed={isSelected}
                aria-label={provider.name}
                title={provider.name}
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
                boxShadow={
                  isSelected ? "0 2px 8px var(--chakra-colors-takeover-lift-soft)" : "none"
                }
                px={3}
                py={2}
                cursor="pointer"
                transition="all 0.15s ease"
                _hover={{ borderColor: isSelected ? "fg" : "border.emphasized" }}
              >
                <Box w="16px" h="16px" flexShrink={0} css={{ "& > svg": { w: "full", h: "full" } }}>
                  {modelProviderIcons[provider.registryKey]}
                </Box>
                <Text textStyle="label" color={isSelected ? "fg" : "fg.muted"}>
                  {provider.name}
                </Text>
              </chakra.button>
            );
          })}
        </Flex>

        <Box key={selected.id} mt={5}>
          <Card variant="emphasized" padding="lg" data-testid="provider-panel">
            <LentEditModelProviderForm
              providerKey={selected.registryKey}
              modelProviderId="new"
              organizationId={organizationId}
              projectId={projectId}
              guided
              onFailed={(failure) => emit("failed", "provider", failure)}
              onSaved={(saved) =>
                onSaved(selected, saved).catch(() =>
                  emit("failed", "provider", {
                    provider: selected.registryKey,
                    code: "save_failed",
                  }),
                )
              }
            />
          </Card>
        </Box>

        <Box mt={5} textAlign="center">
          <chakra.button
            type="button"
            onClick={() => {
              emit("clicked", "skip_tour");
              setConfirmSkip(true);
            }}
            textStyle="label"
            color="fg.subtle"
            cursor="pointer"
            _hover={{ color: "fg.muted" }}
          >
            {SKIP_TOUR_COPY.link}
          </chakra.button>
        </Box>
      </Box>

      <Dialog
        open={confirmSkip}
        onClose={() => setConfirmSkip(false)}
        title={SKIP_TOUR_COPY.title}
        size="sm"
        placement="center"
        ground="card"
        footerDivider
        cancelLabel={null}
        secondaryAction={{
          label: SKIP_TOUR_COPY.skip,
          onClick: () => {
            emit("confirmed", "skip_tour");
            setConfirmSkip(false);
            skip()
              .then(onSkip)
              .catch((error: unknown) => onSkipFailed?.(error));
          },
        }}
        primaryAction={{
          label: SKIP_TOUR_COPY.keep,
          tone: "neutral",
          onClick: () => {
            emit("confirmed", "kept_guide");
            setConfirmSkip(false);
          },
        }}
      >
        <Text textStyle="bodySm" color="fg.muted">
          {SKIP_TOUR_COPY.body}
        </Text>
      </Dialog>
    </TakeoverRow>
  );
}
