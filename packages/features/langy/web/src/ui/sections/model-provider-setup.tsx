/**
 * The model-provider setup Langy embeds when the project has none: pick a
 * provider, paste a key, save, and the panel re-resolves the model in place.
 * Spec: specs/langy/langy-inline-model-setup.feature
 */
import { Box, chakra, HStack, Text, VStack } from "@chakra-ui/react";
import { EditModelProviderForm } from "@langwatch/model-provider-web/surfaces/edit-model-provider-form";
import { modelProviderIcons } from "@langwatch/model-provider-web/surfaces/provider-icons";
import { useCallback, useRef, useState } from "react";
import { langyModelProviders, LANGY_RECOMMENDED_PROVIDER } from "../../model/langy-model-providers";
import { useLangyHost } from "../../model/langy-host";

export type ModelProviderKey = string;

export function LangyModelProviderSetup({
  onComplete,
  initialProviderKey,
}: {
  /** Called once the credential is stored, so the panel can re-resolve. */
  onComplete?: () => void;
  /** Land on this provider — "sign in to Codex again" opens straight on codex. */
  initialProviderKey?: ModelProviderKey;
}) {
  const host = useLangyHost();
  const project = host.project();
  const organization = host.organization();
  const providers = langyModelProviders();

  const [providerKey, setProviderKey] = useState<ModelProviderKey>(
    () => initialProviderKey ?? providers[0]?.provider ?? LANGY_RECOMMENDED_PROVIDER,
  );

  // The panel is a narrow scrolling column and the key fields sit below the
  // fold of the provider grid, so picking a provider has to bring them into
  // view or the click appears to do nothing. Driven from the click rather than
  // an effect, so re-picking the selected provider scrolls too.
  const setupRef = useRef<HTMLDivElement | null>(null);
  const selectProvider = useCallback((key: ModelProviderKey) => {
    setProviderKey(key);
    requestAnimationFrame(() => {
      setupRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }, []);

  return (
    <VStack align="stretch" gap={4}>
      <Text textStyle="xs" color="fg.muted">
        Langy answers on a model you provide. Add a provider key here and it works straight away —
        you can add more later in settings.
      </Text>

      <HStack gap={2} wrap="wrap">
        {providers.map((provider) => (
          <chakra.button
            key={provider.provider}
            type="button"
            aria-pressed={provider.provider === providerKey}
            aria-label={provider.recommended ? `${provider.name}, recommended` : provider.name}
            onClick={() => selectProvider(provider.provider)}
            display="inline-flex"
            alignItems="center"
            gap={2}
            paddingX={2.5}
            paddingY="6px"
            borderRadius="10px"
            borderWidth="1px"
            borderColor={provider.provider === providerKey ? "orange.emphasized" : "border.muted"}
            background={provider.provider === providerKey ? "bg.panel" : "bg.panel/60"}
            color="fg"
            cursor="pointer"
            textStyle="xs"
            transition="border-color 130ms ease, background 130ms ease"
            _hover={{ borderColor: "orange.emphasized" }}
          >
            <chakra.span display="grid" fontSize="14px">
              {modelProviderIcons[provider.provider as keyof typeof modelProviderIcons]}
            </chakra.span>
            {provider.name}
            {provider.recommended ? (
              <chakra.span color="orange.fg" textStyle="2xs">
                Recommended
              </chakra.span>
            ) : null}
          </chakra.button>
        ))}
      </HStack>

      <Box ref={setupRef}>
        <EditModelProviderForm
          key={providerKey}
          providerKey={providerKey}
          modelProviderId="new"
          organizationId={organization?.id}
          projectId={project?.id}
          onSaved={() => onComplete?.()}
        />
      </Box>
    </VStack>
  );
}
