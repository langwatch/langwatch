import { showErrorToast } from "@langwatch/browser-host/errors";
import { toaster } from "@langwatch/design-system/toaster";
import { useLangyStore } from "@langwatch/langy-browser-kit";
import type { LangyDerivedCard } from "@langwatch/langy-contract";
import { type RefObject, useCallback, useEffect, useState } from "react";

import { LANGY_CODE_ACCESS_ASK_AGAIN } from "../../../../../ui/sections/derived-cards/langy-code-access-card.tsx";
import type { LangyPanelSend } from "../../../behavior/panel/use-langy-panel-send.ts";
import type { LangyProposal, ProposalHandlers } from "../message-content.tsx";

/**
 * Applies a proposal through the page's own handler for its kind — once: one already applying,
 * applied or discarded is left alone, and a page that cannot carry it out says so.
 */
export function useLangyProposalApply({
  proposalHandlersRef,
}: {
  proposalHandlersRef?: RefObject<ProposalHandlers>;
}) {
  const appliedOutcomes = useLangyStore((s) => s.appliedOutcomes);
  const discardedProposalIds = useLangyStore((s) => s.discardedProposalIds);
  const applyingProposalIds = useLangyStore((s) => s.applyingProposalIds);
  const markProposalApplying = useLangyStore((s) => s.markProposalApplying);
  const markProposalApplied = useLangyStore((s) => s.markProposalApplied);
  const clearProposalApplying = useLangyStore((s) => s.clearProposalApplying);
  const discard = useLangyStore((s) => s.discardProposal);

  const apply = useCallback(
    async (proposalId: string, proposal: LangyProposal) => {
      const settled =
        applyingProposalIds.has(proposalId) ||
        proposalId in appliedOutcomes ||
        discardedProposalIds.has(proposalId);
      if (settled) return;
      const handler = proposalHandlersRef?.current?.[proposal.kind];
      if (!handler) {
        showErrorToast({
          error: void 0,
          fallbackTitle: "Cannot apply this change here",
          description: `This page cannot carry out ${proposal.kind}. Open the page it belongs to and apply it there.`,
        });
        return;
      }
      markProposalApplying(proposalId);
      try {
        const outcome = await handler(proposal.payload);
        markProposalApplied(proposalId, outcome ?? {});
        toaster.create({
          title: "Applied",
          description: proposal.summary,
          type: "success",
          duration: 3000,
        });
      } catch (error) {
        showErrorToast({ error, fallbackTitle: "Couldn't apply this suggestion" });
      } finally {
        clearProposalApplying(proposalId);
      }
    },
    [
      appliedOutcomes,
      applyingProposalIds,
      clearProposalApplying,
      discardedProposalIds,
      markProposalApplied,
      markProposalApplying,
      proposalHandlersRef,
    ],
  );

  return { appliedOutcomes, discardedProposalIds, applyingProposalIds, apply, discard };
}

/**
 * Change the code access choice: stop the turn running on the old answer (ADR-078) and ask the
 * question again once the DURABLE phase says the stop landed — `send` refuses while a turn runs.
 */
export function useLangyCodeAccessReAsk({
  busy,
  onStop,
  send,
}: {
  busy: boolean;
  onStop: () => void;
  send: LangyPanelSend;
}) {
  const [reAsk, setReAsk] = useState(false);
  const askAgain = useCallback(() => {
    setReAsk(true);
    if (busy) onStop();
  }, [busy, onStop]);
  useEffect(() => {
    if (!reAsk || busy) return;
    setReAsk(false);
    // Nobody typed this, so a failed send must not put it in the composer.
    void send(LANGY_CODE_ACCESS_ASK_AGAIN, { keepOnFailure: false });
  }, [reAsk, busy, send]);
  return askAgain;
}

/**
 * The verify hint's binding (ADR-060 §5): ask Langy, in words through the ordinary send path, to
 * run the real platform query; the measured result arrives as an ordinary measured card.
 */
export function useLangyVerifyDerivedCard(send: LangyPanelSend) {
  return useCallback(
    ({ card }: { card: LangyDerivedCard }) => {
      const subject = "title" in card && card.title ? `"${card.title}"` : "this derived card";
      void send(`Verify ${subject} with a real analytics query and show the measured result.`);
    },
    [send],
  );
}
