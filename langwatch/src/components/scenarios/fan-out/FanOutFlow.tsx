import { useState } from "react";
import { AdjacentScenariosGenerateModal } from "./AdjacentScenariosGenerateModal";
import { FanOutTargetDialog } from "./FanOutTargetDialog";
import type { FanOutSeed, FanOutTarget } from "../services/fanOutGeneration";

/**
 * The fan-out entry flow: pick a target if we don't already know one, then
 * describe (or carry) the seed failure and generate.
 *
 * A seed that came from a failed run already knows its target, so that path
 * skips straight to generation.
 */
export function FanOutFlow({
  open,
  onClose,
  seed,
  knownTarget,
}: {
  open: boolean;
  onClose: () => void;
  /** Omit for the free-text path. */
  seed?: Exclude<FanOutSeed, { type: "FREE_TEXT" }>;
  /** Known when starting from a failed run; otherwise the user picks one. */
  knownTarget?: FanOutTarget;
}) {
  const [target, setTarget] = useState<FanOutTarget | null>(knownTarget ?? null);

  const handleClose = () => {
    setTarget(knownTarget ?? null);
    onClose();
  };

  if (!open) return null;

  if (!target) {
    return (
      <FanOutTargetDialog open={open} onClose={handleClose} onConfirm={setTarget} />
    );
  }

  return (
    <AdjacentScenariosGenerateModal
      open={open}
      onClose={handleClose}
      target={target}
      seed={seed}
    />
  );
}
