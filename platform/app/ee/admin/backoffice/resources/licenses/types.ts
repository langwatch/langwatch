import type { RouterOutputs } from "~/utils/api";

export const SERVICES = ["instant_evals", "managed_models"] as const;

export type Service = (typeof SERVICES)[number];

export const SERVICE_LABELS: Record<Service, string> = {
  instant_evals: "Instant Evals",
  managed_models: "Managed models",
};

export type License =
  RouterOutputs["licenseRegistry"]["getAll"]["licenses"][number];
