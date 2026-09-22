import { Button, HStack, IconButton, Text } from "@chakra-ui/react";
import { Sparkles, X } from "lucide-react";
import type React from "react";
import { useCallback, useState } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import NextLink from "~/utils/compat/next-link";
import { useExplorerStore } from "../../stores/explorerStore";
import type { SearchNotice } from "../../stores/querySlice";
import { MODEL_PROVIDERS_HREF } from "../TracesPage/InstantEvalRefusalPopover";

/** What the sentence was read as. */
const INTERPRETED_AS: Record<SearchNotice["interpretedAs"], string> = {
  instant_eval: "Interpreted as an Instant Eval.",
  free_text: "Interpreted as a phrase.",
};

/** What happened to the words instead of being sharpened. */
const AS_TYPED: Record<SearchNotice["interpretedAs"], string> = {
  instant_eval: "so your words are judged as typed",
  free_text: "so your words are matched as typed",
};

/**
 * Remembering a dismissal, per project.
 *
 * Per project because the model is configured per project, so a reader who
 * has decided to live with it in one workspace has decided nothing about
 * another. Storage can be unavailable (a private window, blocked site data),
 * and the button is worth more than the memory of it being dismissed, so a
 * failure to read or write leaves it showing.
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
    // The button shows again next time, which is the harmless direction.
  }
}

/**
 * The line: what the search was read as, and why it was not sharpened.
 *
 * The code is shown beside the sentence rather than resolved through the
 * code-keyed copy registry, which is the exception rather than the rule here.
 * The registry supplies the words a reader gets INSTEAD of a code, for a
 * failure that stopped what they were doing; this search ran, the sentence
 * beside the code already says what happened and what to do, and the entry
 * for `ai_query_provider_error` ("Couldn't turn that into a search. Rephrase
 * it, or pick a different model.") would contradict the judgement now
 * running. What the code adds is a handle the reader can quote to support,
 * and it is a handled code, which is written to be read by a customer.
 */
function line(notice: SearchNotice): React.ReactNode {
  const asTyped = AS_TYPED[notice.interpretedAs];
  const read = INTERPRETED_AS[notice.interpretedAs];
  if (notice.modelTrouble === "no_model") {
    return `${read} No model is connected for search, ${asTyped}.`;
  }
  return (
    <>
      {`${read} The search model failed`}
      {notice.modelErrorCode ? (
        <>
          {" ("}
          <Text as="span" color="fg" fontFamily="mono">
            {notice.modelErrorCode}
          </Text>
          {")"}
        </>
      ) : null}
      {`, ${asTyped}.`}
    </>
  );
}

/**
 * The way to fix it, which can be dismissed.
 *
 * The line itself is not dismissible: it explains the chips now on screen
 * and it is how a reader learns the search ran degraded. The button is,
 * because a reader who knows where the setting is should not be offered it
 * on every search. Mounted under the project's own key, so the remount is
 * what re-reads storage for the project now on screen rather than leaving
 * the previous one's answer in state.
 */
const ConfigureModels: React.FC<{ projectId: string }> = ({ projectId }) => {
  const [isDismissed, setIsDismissed] = useState(() =>
    readDismissed(projectId),
  );
  const dismiss = useCallback(() => {
    setIsDismissed(true);
    writeDismissed(projectId);
  }, [projectId]);

  if (isDismissed) return null;

  return (
    <>
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
    </>
  );
};

/**
 * The strip under the bar after a search ran without the model that shapes
 * it.
 *
 * One line: what the sentence was read as, and why the words were used as
 * they were typed. The question is not repeated here, since the chip and the
 * progress bar over the table both already carry it.
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
    <HStack
      gap={2}
      paddingX={3}
      paddingY={1.5}
      borderBottomWidth="1px"
      borderColor="border.subtle"
      bg="bg.subtle"
      role="status"
    >
      <Sparkles size={11} />
      <Text textStyle="xs" color="fg.muted" flex={1}>
        {line(notice)}
      </Text>
      <ConfigureModels key={notice.projectId} projectId={notice.projectId} />
    </HStack>
  );
};
