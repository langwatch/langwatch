/**
 * What the create drawer lends the guided tour: it types the key's name and submits through the
 * drawer's own state, so the key it mints is a real one; and the key it mints is recorded.
 * Spec: specs/features/onboarding/guided-tour.feature
 */

import { useEffect, useMemo, useRef } from "react";

import { api } from "../../../behavior/gateway-api.ts";
import { useLentGuidedTour } from "../../../behavior/lent-guided-tour.ts";
import { freeVirtualKeyName } from "../../../model/free-virtual-key-name.ts";

const TYPING_INTERVAL_MS = 60;

/** Records the tour's key on the guided state; a failure costs the brief a line, not the key. */
export function useRecordMintedKey(): (minted: {
  organizationId: string;
  name: string;
  revealId?: string;
  preview?: string;
}) => Promise<void> {
  const { useRecordVirtualKeyReveal } = useLentGuidedTour();
  const recordReveal = useRecordVirtualKeyReveal();
  return async ({ organizationId, name, revealId, preview }) => {
    if (!revealId || !preview) return;
    await recordReveal({ organizationId, name, preview, revealId }).catch(() => undefined);
  };
}

/**
 * Registers `typeVirtualKeyName` and `submitVirtualKeyCreate` while the drawer is mounted. The
 * name typed is the first one the organization's listed keys do not carry yet, so a replay never
 * mints a duplicate. The submit is read through a ref: the actions register once.
 */
export function useVirtualKeyTourActions({
  organizationId,
  setName,
  submit,
}: {
  organizationId: string;
  setName: (name: string) => void;
  submit: (options: { revealOnce: boolean }) => Promise<void>;
}) {
  const { useRegisterActions } = useLentGuidedTour();
  const utils = api.useUtils();
  const submitRef = useRef(submit);
  submitRef.current = submit;
  const typingTimers = useRef<number[]>([]);
  useEffect(
    () => () => {
      for (const timer of typingTimers.current) clearTimeout(timer);
    },
    [],
  );
  const actions = useMemo(
    () => ({
      typeVirtualKeyName: (wanted: string) => {
        const listed = utils.virtualKeys.list.getData({ organizationId }) ?? [];
        const typed = freeVirtualKeyName({ wanted, taken: listed.map((key) => key.name) });
        for (const timer of typingTimers.current) clearTimeout(timer);
        typingTimers.current = [];
        setName("");
        for (let i = 1; i <= typed.length; i++) {
          typingTimers.current.push(
            window.setTimeout(() => setName(typed.slice(0, i)), i * TYPING_INTERVAL_MS),
          );
        }
      },
      submitVirtualKeyCreate: () => submitRef.current({ revealOnce: true }),
    }),
    [utils, organizationId, setName],
  );
  useRegisterActions(actions);
}
