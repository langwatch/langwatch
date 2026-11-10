import {
  allowedProxyHosts,
  blockLocalHttpCalls,
  Config,
  type ConfigOf,
  foldCacheTtlSeconds,
  isSaas,
  publicBaseUrl,
} from "@langwatch/config";
import { z } from "zod";

/** A positive whole number, or nothing when the variable is unset or blank. */
const optionalPositiveInt = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.coerce.number().int().positive().optional(),
);

/** The address fence a run reads a dataset row's attachment link behind, and its cell window. */
export const experimentConfig = Config.define((c) => ({
  blockLocalHttpCalls,
  allowedProxyHosts,
  /** Cells of one run in flight at once when the request names no limit (main's knob). */
  runConcurrency: c.env("EVAL_V3_CONCURRENCY", z.coerce.number().int().positive().default(10)),
  /** Soft cell budget a project's runs split at start (runs keep it; total can exceed it). */
  projectCellBudget: c.env("EVAL_V3_PROJECT_CELL_BUDGET", optionalPositiveInt),
  /** Cells every project's runs share; caps the dynamic default when set. */
  globalCellBudget: c.env("EVAL_V3_GLOBAL_CELL_BUDGET", optionalPositiveInt),
  /** The shared deployment origin: the link a polled run answers with; absent, runs are refused. */
  publicBaseUrl,
  /** Main's run-link origin, read only when BASE_HOST is unset; deprecated, warned at boot. */
  legacyPublicBaseUrl: c.env(
    "NEXT_PUBLIC_BASE_URL",
    z
      .string()
      .optional()
      .transform((value) => value?.trim() || void 0),
  ),
  /** LangWatch's own cloud, where a run's outbound calls verify TLS. */
  foldCacheTtlSeconds,
  isSaas,
}));

export type ExperimentServerConfig = ConfigOf<typeof experimentConfig>;
