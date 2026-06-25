import {
  Box,
  Button,
  HStack,
  Icon,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { diffLines } from "diff";
import { useMemo, useState } from "react";
import { LuRocket } from "react-icons/lu";

import {
  DialogBody,
  DialogCloseTrigger,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from "~/components/ui/dialog";
import { toaster } from "~/components/ui/toaster";
import { Tooltip } from "~/components/ui/tooltip";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

import type { TargetConfig } from "../types";

/**
 * Win-rate floor below which we won't let the user promote. The pairwise
 * verdict gets noisy under this threshold, and "B wins 51%" isn't a strong
 * enough signal to ship to prod. Surfaced as a prop so callers can override
 * for staging-tier targets.
 */
export const PROMOTE_WIN_RATE_THRESHOLD = 0.6;

const PRODUCTION_TAG = "production";

export type PromoteWinnerButtonProps = {
  variantId: string;
  variantName: string;
  /** Pull promptId / promptVersionId / promptVersionNumber / localPromptConfig from here. */
  target: TargetConfig;
  /** Aggregate pairwise verdict for this variant. */
  verdictSummary: {
    wins: number;
    totalRows: number;
    /** 0..1 — winning win rate across non-tie rows. */
    winRate: number;
    /** Optional dataset name for the verdict-summary line. */
    datasetName?: string;
  };
  /** ID of the row-level evaluator cell that produced the verdict. */
  evalId: string;
  /** Experiment id the pairwise eval ran in. */
  experimentId: string;
  /** Optional experiment run id (when promotion happens from a specific run). */
  runId?: string;
  /**
   * Visual variant. Default is the named-button form rendered for ≤2-way
   * pairwise. The header bar's N-way popover passes "menu-item" so the
   * disabled tooltip-wrapped button fits inside the popover.
   */
  layout?: "named-button" | "menu-item";
  /** Override the default threshold for this render. */
  winRateThreshold?: number;
};

/**
 * Promotes the winning variant's prompt to the production tag.
 *
 * Renders disabled with a tooltip when the variant isn't promotable
 * (non-prompt target, missing version id, win rate below threshold). On
 * click, opens a confirmation modal showing the prompt diff vs current
 * prod plus the verdict summary; on confirm, calls the existing
 * prompts.assignTag tRPC mutation with audit-trail metadata (#5104).
 */
export function PromoteWinnerButton({
  variantId,
  variantName,
  target,
  verdictSummary,
  evalId,
  experimentId,
  runId,
  layout = "named-button",
  winRateThreshold = PROMOTE_WIN_RATE_THRESHOLD,
}: PromoteWinnerButtonProps) {
  const { project } = useOrganizationTeamProject();
  const [modalOpen, setModalOpen] = useState(false);

  const disabledReason = useMemo(() => {
    if (target.type !== "prompt") {
      return "Only prompt targets can be promoted. Workflow / HTTP / agent targets are not promotable in this version.";
    }
    if (!target.promptId || !target.promptVersionId) {
      return "This variant has no saved prompt version to promote. Save the prompt first.";
    }
    if (verdictSummary.winRate < winRateThreshold) {
      const pct = Math.round(winRateThreshold * 100);
      return `Win rate too close to tie to promote (need ≥${pct}%).`;
    }
    return null;
  }, [
    target.type,
    target.promptId,
    target.promptVersionId,
    verdictSummary.winRate,
    winRateThreshold,
  ]);

  const isDisabled = disabledReason !== null;
  const buttonLabel =
    layout === "menu-item" ? variantName : `Promote ${variantName}`;

  const button = (
    <Button
      key={variantId}
      size="xs"
      variant="ghost"
      justifyContent={layout === "menu-item" ? "flex-start" : "center"}
      disabled={isDisabled}
      onClick={() => !isDisabled && setModalOpen(true)}
      data-testid={`promote-winner-button-${variantId}`}
    >
      <Icon as={LuRocket} boxSize="14px" />
      {buttonLabel}
    </Button>
  );

  return (
    <>
      {isDisabled ? (
        <Tooltip content={disabledReason ?? ""} positioning={{ placement: "top" }}>
          {/* Wrap in a Box so the disabled button still gets pointer events for the tooltip. */}
          <Box display="inline-flex">{button}</Box>
        </Tooltip>
      ) : (
        button
      )}

      {modalOpen && project?.id && target.promptId && target.promptVersionId ? (
        <PromoteConfirmModal
          projectId={project.id}
          promptId={target.promptId}
          proposedVersionId={target.promptVersionId}
          proposedVersionNumber={target.promptVersionNumber}
          variantName={variantName}
          verdictSummary={verdictSummary}
          source={{
            kind: "pairwise-eval",
            evalId,
            experimentId,
            ...(runId ? { runId } : {}),
          }}
          onClose={() => setModalOpen(false)}
        />
      ) : null}
    </>
  );
}

type PromoteConfirmModalProps = {
  projectId: string;
  promptId: string;
  proposedVersionId: string;
  proposedVersionNumber?: number;
  variantName: string;
  verdictSummary: PromoteWinnerButtonProps["verdictSummary"];
  source: {
    kind: "pairwise-eval";
    evalId: string;
    experimentId: string;
    runId?: string;
  };
  onClose: () => void;
};

function PromoteConfirmModal({
  projectId,
  promptId,
  proposedVersionId,
  proposedVersionNumber,
  variantName,
  verdictSummary,
  source,
  onClose,
}: PromoteConfirmModalProps) {
  const utils = api.useContext();

  // The version currently pinned to `production`. May be undefined when no
  // prod tag is set yet — that's a clean first-promotion case.
  const currentProdQuery = api.prompts.getByIdOrHandle.useQuery(
    { idOrHandle: promptId, projectId, tag: PRODUCTION_TAG },
    { enabled: !!promptId && !!projectId, retry: false },
  );

  // The winning variant's full version body, so we can diff against prod.
  const proposedQuery = api.prompts.getByIdOrHandle.useQuery(
    { idOrHandle: promptId, projectId, versionId: proposedVersionId },
    { enabled: !!promptId && !!projectId && !!proposedVersionId },
  );

  const assignTagMutation = api.prompts.assignTag.useMutation();

  // Capture the prod version at modal-open time so the server can surface
  // a `prod_changed` warning if it moves while the user is reading.
  const expectedPriorVersionId =
    (currentProdQuery.data as { versionId?: string } | undefined)?.versionId ??
    "";

  const diffText = useMemo(() => {
    const prior = renderPromptBody(currentProdQuery.data ?? null);
    const proposed = renderPromptBody(proposedQuery.data ?? null);
    return diffLines(prior, proposed);
  }, [currentProdQuery.data, proposedQuery.data]);

  const winRatePct = Math.round(verdictSummary.winRate * 100);
  const verdictLine = verdictSummary.datasetName
    ? `Won ${verdictSummary.wins}/${verdictSummary.totalRows} rows on dataset "${verdictSummary.datasetName}" (${winRatePct}% win rate)`
    : `Won ${verdictSummary.wins}/${verdictSummary.totalRows} rows (${winRatePct}% win rate)`;

  const handleConfirm = async () => {
    try {
      const result = (await assignTagMutation.mutateAsync({
        projectId,
        configId: promptId,
        versionId: proposedVersionId,
        tag: PRODUCTION_TAG,
        source,
        // Empty string when no prior assignment — service compares against
        // null and treats both as "no prior writer", so no false-positive
        // warning fires on the very first promotion.
        expectedPriorVersionId,
      })) as { warning?: "prod_changed" };

      // Invalidate so the version-history popover + the prod-tag readout
      // re-fetch with the new pin.
      await utils.prompts.getTagsForConfig.invalidate({
        configId: promptId,
        projectId,
      });
      await utils.prompts.getByIdOrHandle.invalidate({
        idOrHandle: promptId,
        projectId,
      });

      toaster.create({
        title: `${variantName} is now prod`,
        type: "success",
        duration: 2500,
        meta: { closable: true },
      });

      if (result.warning === "prod_changed") {
        toaster.create({
          title: "Prod moved during your eval",
          description:
            "Another writer pinned a different version to production while this eval was open. Your promotion still applied — but double-check.",
          type: "warning",
          duration: 6000,
          meta: { closable: true },
        });
      }

      onClose();
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to promote";
      toaster.create({
        title: "Promotion failed",
        description: message,
        type: "error",
        duration: 5000,
        meta: { closable: true },
      });
    }
  };

  const isLoading = currentProdQuery.isLoading || proposedQuery.isLoading;
  const isError = currentProdQuery.isError || proposedQuery.isError;

  return (
    <DialogRoot
      open
      onOpenChange={(e) => !e.open && onClose()}
      size="lg"
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Promote {variantName} to prod?</DialogTitle>
        </DialogHeader>
        <DialogCloseTrigger />
        <DialogBody>
          <VStack align="stretch" gap={4}>
            <Text fontSize="sm" color="fg.muted">
              {verdictLine}
            </Text>

            {isLoading ? (
              <HStack gap={2}>
                <Spinner size="sm" />
                <Text fontSize="sm" color="fg.muted">
                  Loading prompt diff…
                </Text>
              </HStack>
            ) : isError ? (
              <Text fontSize="sm" color="red.500">
                Could not load the current production version to diff against.
                You can still promote, but you won't see the diff.
              </Text>
            ) : (
              <Box>
                <Text fontSize="xs" color="fg.muted" mb={1}>
                  Diff: current prod
                  {(currentProdQuery.data as { version?: number } | undefined)
                    ?.version
                    ? ` (v${(currentProdQuery.data as { version: number }).version})`
                    : " (none)"}{" "}
                  →{" "}
                  {variantName}
                  {proposedVersionNumber ? ` (v${proposedVersionNumber})` : ""}
                </Text>
                <Box
                  as="pre"
                  borderWidth="1px"
                  borderColor="border.muted"
                  borderRadius="md"
                  padding={3}
                  maxHeight="320px"
                  overflow="auto"
                  fontSize="xs"
                  fontFamily="mono"
                  whiteSpace="pre-wrap"
                  data-testid="promote-winner-diff"
                >
                  {diffText.map((part, i) => (
                    <Box
                      as="span"
                      key={i}
                      color={
                        part.added
                          ? "green.fg"
                          : part.removed
                            ? "red.fg"
                            : "fg.muted"
                      }
                      bg={
                        part.added
                          ? "green.subtle"
                          : part.removed
                            ? "red.subtle"
                            : undefined
                      }
                    >
                      {part.added ? "+ " : part.removed ? "- " : "  "}
                      {part.value}
                    </Box>
                  ))}
                </Box>
              </Box>
            )}
          </VStack>
        </DialogBody>
        <DialogFooter>
          <HStack gap={2}>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              colorPalette="blue"
              size="sm"
              onClick={() => void handleConfirm()}
              loading={assignTagMutation.isPending}
            >
              Confirm promotion
            </Button>
          </HStack>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}

/**
 * Render a prompt-version body as a stable, line-oriented string so diffLines
 * produces readable hunks. Falls back gracefully on partial data: a missing
 * version still produces a coherent (mostly-blank) frame the diff can chew on.
 */
function renderPromptBody(
  data: Record<string, unknown> | null | undefined,
): string {
  if (!data) return "";
  const model = typeof data.model === "string" ? data.model : "";
  const temperature =
    typeof data.temperature === "number" ? data.temperature : undefined;
  const prompt = typeof data.prompt === "string" ? data.prompt : "";
  const messages = Array.isArray(data.messages)
    ? (data.messages as Array<{ role?: string; content?: string }>)
    : [];

  const lines: string[] = [];
  if (model) lines.push(`model: ${model}`);
  if (temperature !== undefined) lines.push(`temperature: ${temperature}`);
  lines.push("");
  if (prompt) {
    lines.push("system:");
    lines.push(prompt);
    lines.push("");
  }
  for (const message of messages) {
    lines.push(`${message.role ?? "unknown"}:`);
    lines.push(message.content ?? "");
    lines.push("");
  }
  return lines.join("\n");
}
