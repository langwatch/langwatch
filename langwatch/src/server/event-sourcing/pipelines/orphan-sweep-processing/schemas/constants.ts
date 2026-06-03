export const ORPHAN_SWEEP_COMMAND_TYPES = {
  SWEEP_TENANT: "lw.orphan_sweep.sweep_tenant",
} as const;

export const ORPHAN_SWEEP_PROCESSING_COMMAND_TYPES = [
  ORPHAN_SWEEP_COMMAND_TYPES.SWEEP_TENANT,
] as const;

export type OrphanSweepProcessingCommandType =
  (typeof ORPHAN_SWEEP_PROCESSING_COMMAND_TYPES)[number];
