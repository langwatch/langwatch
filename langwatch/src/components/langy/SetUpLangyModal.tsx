import {
  Box,
  Button,
  HStack,
  Icon,
  Separator,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import {
  ModelSelector,
  allModelOptions,
  useModelSelectionOptions,
} from "~/components/ModelSelector";
import { Dialog } from "~/components/ui/dialog";
import { Link } from "~/components/ui/link";
import { toaster } from "~/components/ui/toaster";
import { api } from "~/utils/api";
import { titleCase } from "~/utils/stringCasing";
import { computeLangyModelSetup } from "./langyModelSetup";

// Plain deep-link to the real provider form — the single source of truth for
// adding/validating a provider (no duplicated validation here). Opened in a
// new tab so this modal stays mounted; the providers query refetches on focus
// when the user returns, advancing branch C → A/B automatically.
const MODEL_PROVIDERS_SETTINGS_PATH = "/settings/model-providers";

export interface SetUpLangyModalProps {
  open: boolean;
  projectId: string | undefined;
  onClose: () => void;
  /**
   * Fired once a usable default model has been persisted. The host should
   * re-check Langy readiness (and may retry the user's pending message).
   */
  onReady: () => void;
}

/**
 * Adaptive "Set up Langy" modal (#4274). One surface that takes a project from
 * "Langy can't run" to "Langy works", with no dead ends:
 *
 *   ① Langy key — informational; PR1 (#4273) already auto-provisions it.
 *   ② Model — server-derived branch:
 *       A  Anthropic enabled    → one-click "Use Anthropic"
 *       B  other provider only  → one-click "Use your <provider>" + Anthropic nudge
 *       C  nothing enabled      → "Add a model →" deep-link to provider settings
 *
 * Confirming persists the chosen model as the project's DEFAULT-role default
 * (the key Langy's gate, getVercelAIModel → prompt.create_default, resolves).
 */
export function SetUpLangyModal({
  open,
  projectId,
  onClose,
  onReady,
}: SetUpLangyModalProps) {
  const utils = api.useContext();
  const providersQuery = api.modelProvider.getAllForProjectForFrontend.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId && open, refetchOnWindowFocus: true },
  );
  const saveMutation = api.modelProvider.saveDefaultModelsConfig.useMutation();

  // getAllForProjectForFrontend returns { providers, modelMetadata }; the
  // enabled-provider map we branch on lives under `.providers`.
  const setup = computeLangyModelSetup(providersQuery.data?.providers);

  // The chat model the confirm action will persist. Seeded from the branch's
  // primary provider once options load; the dropdown lets the user override.
  const [selectedModel, setSelectedModel] = useState("");
  const { selectOptions } = useModelSelectionOptions(
    allModelOptions,
    selectedModel,
    "chat",
  );

  // Pre-select a model so branches A/B are genuinely one-click. Prefer the
  // branch's primary provider; fall back to the first available option so the
  // confirm button is never stranded disabled when models exist but none match
  // the primary (e.g. a provider counts as "enabled" but offers no chat model
  // in the picker). The user can still change it.
  useEffect(() => {
    if (selectedModel || selectOptions.length === 0) return;
    const primary = setup.primaryProviderKey;
    const preferred = primary
      ? selectOptions.find((o) => o.value.startsWith(`${primary}/`))
      : undefined;
    setSelectedModel((preferred ?? selectOptions[0]!).value);
  }, [selectedModel, setup.primaryProviderKey, selectOptions]);

  const handleConfirm = async () => {
    if (!projectId || !selectedModel) return;
    try {
      await saveMutation.mutateAsync({
        config: { DEFAULT: selectedModel },
        scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
      });
      // Refresh the gate readiness + the settings snapshot so the host (and
      // the Default Models page) reflect the new default immediately.
      await Promise.all([
        utils.modelProvider.getResolvedDefault.invalidate(),
        utils.modelProvider.getDefaultModelsForProject.invalidate(),
      ]);
      toaster.create({
        title: "Langy is ready",
        description: `Using ${selectedModel}`,
        type: "success",
        duration: 4000,
        meta: { closable: true },
      });
      onReady();
      onClose();
    } catch (error) {
      toaster.create({
        title: "Couldn't set the model",
        description:
          error instanceof Error ? error.message : "Please try again.",
        type: "error",
        duration: 6000,
        meta: { closable: true },
      });
    }
  };

  // Label names the provider that will actually be saved (derived from the
  // selected model), so the button never promises "Use Anthropic" while a
  // different model is selected.
  const selectedProvider = selectedModel.split("/")[0] ?? "";
  const confirmLabel = selectedProvider
    ? `Use ${titleCase(selectedProvider)}`
    : "Use this model";

  return (
    <Dialog.Root open={open} onOpenChange={(d) => !d.open && onClose()}>
      <Dialog.Content bg="bg">
        <Dialog.CloseTrigger />
        <Dialog.Header>
          <HStack gap={2}>
            <Icon as={Sparkles} color="purple.500" boxSize={5} />
            <Dialog.Title>Set up Langy</Dialog.Title>
          </HStack>
        </Dialog.Header>
        <Dialog.Body>
          <VStack align="stretch" gap={5} py={2}>
            {/* ① Langy key — informational (PR1 auto-provisions it). */}
            <HStack gap={2} align="center">
              <Icon as={Check} color="green.500" boxSize={5} />
              <Text fontSize="sm">
                A dedicated Langy key is ready for this project.
              </Text>
            </HStack>

            <Separator />

            {/* ② Model. */}
            {providersQuery.isLoading ? (
              <Skeleton height="40px" borderRadius="md" />
            ) : setup.branch === "none" ? (
              <VStack align="stretch" gap={3}>
                <Text fontSize="sm" color="fg.muted">
                  Langy needs an AI model to run. Add a model provider to
                  continue — we recommend Anthropic.
                </Text>
                <Button colorPalette="purple" alignSelf="flex-start" asChild>
                  <a
                    data-testid="langy-add-model"
                    href={MODEL_PROVIDERS_SETTINGS_PATH}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "white" }}
                  >
                    <HStack gap={2}>
                      <Text>Add a model</Text>
                      <Icon as={ArrowRight} boxSize={4} />
                    </HStack>
                  </a>
                </Button>
                <Text fontSize="xs" color="fg.subtle">
                  Opens settings in a new tab. Come back here when you&apos;re
                  done — Langy picks it up automatically.
                </Text>
              </VStack>
            ) : (
              <VStack align="stretch" gap={3}>
                <Text fontSize="sm" color="fg.muted">
                  Choose the model Langy will use:
                </Text>
                <Box>
                  <ModelSelector
                    model={selectedModel}
                    options={allModelOptions}
                    onChange={setSelectedModel}
                    mode="chat"
                    size="full"
                    showConfigureAction
                  />
                </Box>
                {setup.showAnthropicNudge && (
                  <Link
                    href={MODEL_PROVIDERS_SETTINGS_PATH}
                    isExternal
                    fontSize="xs"
                    color="purple.500"
                  >
                    Add Anthropic for the best Langy experience →
                  </Link>
                )}
              </VStack>
            )}
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          {setup.branch !== "none" && (
            <Button
              data-testid="langy-confirm-model"
              colorPalette="purple"
              onClick={() => void handleConfirm()}
              loading={saveMutation.isPending}
              disabled={!selectedModel}
            >
              {confirmLabel}
            </Button>
          )}
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
