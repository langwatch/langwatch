import { Button, HStack, IconButton, Text } from "@chakra-ui/react";
import { type SearchNotice, useFilterStore } from "@langwatch/trace-browser-kit";
import { Sparkles, X } from "lucide-react";
import type React from "react";
import { useCallback, useState } from "react";

import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project.ts";
import NextLink from "../../../elements/next-link.tsx";

const MODEL_PROVIDERS_HREF = "/settings/model-providers";

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
 * A dismissal is remembered per project, because the model is configured per
 * project. Storage can be unavailable (a private window, blocked site data), and
 * a failure to read or write it leaves the button showing.
 */
const dismissKey = (projectId: string) => `traces-v2:search-model-hint-dismissed:${projectId}`;

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
 * What the search was read as and why it was not sharpened. The code is shown as
 * a handle to quote to support, not resolved through the copy registry, whose
 * words ("Couldn't turn that into a search") would contradict the search that ran.
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
 * The way to fix it, which can be dismissed; the line explaining the chips
 * cannot. Mounted under the project's key, so a remount re-reads storage for
 * the project on screen rather than keeping the previous one's answer.
 */
const ConfigureModels: React.FC<{ projectId: string }> = ({ projectId }) => {
  const [isDismissed, setIsDismissed] = useState(() => readDismissed(projectId));
  const dismiss = useCallback(() => {
    setIsDismissed(true);
    writeDismissed(projectId);
  }, [projectId]);

  if (isDismissed) return null;

  return (
    <>
      <NextLink href={MODEL_PROVIDERS_HREF} target="_blank" rel="noopener noreferrer">
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
 * The strip under the bar after a search ran without the model that shapes it:
 * what the sentence was read as, and why the words were used as typed.
 * Spec: specs/traces-v2/search.feature ("A search without a model says so").
 */
export const SearchFallbackNotice: React.FC = () => {
  const { project } = useOrganizationTeamProject();
  const queryText = useFilterStore((s) => s.queryText);
  const notice = useFilterStore((s) => s.searchNotice);

  if (!notice || notice.projectId !== project?.id || notice.query !== queryText) {
    return null;
  }

  return (
    <HStack
      as="output"
      gap={2}
      paddingX={3}
      paddingY={1.5}
      borderBottomWidth="1px"
      borderColor="border.subtle"
      bg="bg.subtle"
    >
      <Sparkles size={11} />
      <Text textStyle="xs" color="fg.muted" flex={1}>
        {line(notice)}
      </Text>
      <ConfigureModels key={notice.projectId} projectId={notice.projectId} />
    </HStack>
  );
};
