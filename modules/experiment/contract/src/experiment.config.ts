import {
  allowedProxyHosts,
  blockLocalHttpCalls,
  Config,
  type ConfigOf,
  isSaas,
  publicBaseUrl,
} from "@langwatch/config";
import { z } from "zod";

/** The address fence a run reads a dataset row's attachment link behind, and its cell window. */
export const experimentConfig = Config.define((c) => ({
  blockLocalHttpCalls,
  allowedProxyHosts,
  /** Cells of one run in flight at once when the request names no limit (main's knob). */
  runConcurrency: c.env("EVAL_V3_CONCURRENCY", z.coerce.number().int().positive().default(10)),
  /** The shared deployment origin: the link a polled run answers with; absent, runs are refused. */
  publicBaseUrl,
  /** LangWatch's own cloud, where a run's outbound calls verify TLS. */
  isSaas,
}));

export type ExperimentServerConfig = ConfigOf<typeof experimentConfig>;
