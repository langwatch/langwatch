import { Button, HStack, IconButton, Text, VStack } from "@chakra-ui/react";
import { Sparkles, X } from "lucide-react";
import type React from "react";
import { useCallback, useState } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { ModelTrouble } from "~/server/app-layer/traces/search-router/contracts";
import NextLink from "~/utils/compat/next-link";
import { useExplorerStore } from "../../stores/explorerStore";
import { MODEL_PROVIDERS_HREF } from "../TracesPage/InstantEvalRefusalPopover";

/** What the reader is told, per model problem. */
const HINT: Record<ModelTrouble, string> = {
  no_model:
    "No model is connected for search. With one, a sentence typed here becomes a sharper question, a filter, or a job for the assistant.",
  model_failed:
    "The model connected for search did not answer, so your words were used as written. Check its provider, or pick another model.",
};

/**
 * Remembering a dismissal, per project.
 *
 * Per project because the model is configured per project, so a reader who
 * has decided to live with it in one workspace has decided nothing about
 * another. Storage can be unavailable (a private window, blocked site data),
 * and the strip is worth more than the memory of it being dismissed, so a
 * failure to read or write leaves the hint showing.
 */
const dismissKey = (projectId: string) =>
  `traces-v2:search-model-hint-dismissed:${projectId}`;

function readDismissed(projectId: string | undefined): boolean {
  if (!projectId) return false;
  try {
    return window.localStorage.getItem(dismissKey(projectId)) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(projectId: string): void {
  try {
    window.localStorage.setItem(dismissKey(projectId), "1");
  } catch {
    // The hint shows again next time, which is the harmless direction.
  }
}

/** The one line naming what the sentence was read as. */
function interpretation(notice: {
  interpretedAs: "instant_eval" | "free_text";
  question?: string;
}): React.ReactNode {
  if (notice.interpretedAs === "free_text") {
    return "Interpreted as: the words as one phrase.";
  }
  return (
    <>
      Interpreted as: a judgement of every result, asking{" "}
      <Text as="span" color="fg" fontFamily="mono">
        {notice.question}
      </Text>
    </>
  );
}

/**
 * Why no model shaped the search, and the way to fix that.
 *
 * Dismissible, and dismissed per project, so it is mounted under the
 * project's own key: the remount is what re-reads storage for the project
 * now on screen rather than leaving the previous one's answer in state.
 */
const ModelTroubleHint: React.FC<{
  projectId: string;
  modelTrouble: ModelTrouble;
}> = ({ projectId, modelTrouble }) => {
  const [isDismissed, setIsDismissed] = useState(() =>
    readDismissed(projectId),
  );
  const dismiss = useCallback(() => {
    setIsDismissed(true);
    writeDismissed(projectId);
  }, [projectId]);

  if (isDismissed) return null;

  return (
    <HStack gap={2} paddingLeft={5}>
      <Text textStyle="xs" color="fg.muted" flex={1}>
        {HINT[modelTrouble]}
      </Text>
      <NextLink
        href={MODEL_PROVIDERS_HREF}
        target="_blank"
        rel="noopener noreferrer"
      >
        <Button size="2xs" variant="outline">
          Configure models
        </Button>
      </NextLink>
      <IconButton
        size="2xs"
        variant="ghost"
        color="fg.muted"
        aria-label="Dismiss"
        onClick={dismiss}
      >
        <X size={11} />
      </IconButton>
    </HStack>
  );
};

/**
 * The strip under the bar after a search ran without the model that shapes
 * it.
 *
 * Two things, in the order they matter. What the sentence was read as, which
 * is not dismissible because it explains the chips or the quotes now on
 * screen. Then why no model shaped it, with the way to fix that, which is
 * dismissible: the search still ran, and a reader who knows already should
 * not be told again.
 *
 * Spec: specs/traces-v2/search.feature ("A search without a model says so").
 */
export const SearchFallbackNotice: React.FC = () => {
  const { project } = useOrganizationTeamProject();
  const queryText = useExplorerStore((s) => s.queryText);
  const notice = useExplorerStore((s) => s.searchNotice);

  if (
    !notice ||
    notice.projectId !== project?.id ||
    notice.query !== queryText
  ) {
    return null;
  }

  return (
    <VStack
      align="stretch"
      gap={1}
      paddingX={3}
      paddingY={1.5}
      borderBottomWidth="1px"
      borderColor="border.subtle"
      bg="bg.subtle"
      role="status"
    >
      <HStack gap={2}>
        <Sparkles size={11} />
        <Text textStyle="xs" color="fg.muted" flex={1}>
          {interpretation(notice)}
        </Text>
      </HStack>
      <ModelTroubleHint
        key={notice.projectId}
        projectId={notice.projectId}
        modelTrouble={notice.modelTrouble}
      />
    </VStack>
  );
};
