/**
 * The hosted services the Connect page lists, each with what it sends, and
 * the two figures it writes out.
 * @see specs/self-hosting/connected-services/connect-settings.feature
 */

import type { ConnectService } from "@langwatch/enterprise-licensing-contract";
import { Temporal } from "@langwatch/time";

export interface HostedService {
  id: ConnectService;
  name: string;
  description: string;
  /** What leaves the install while the service is on, one statement per line. */
  dataStatements: readonly string[];
}

export const HOSTED_SERVICES = [
  {
    id: "instant_evals",
    name: "Instant Evals",
    description:
      "Judges your evaluations on LangWatch, so this install needs no model of its own for them.",
    dataStatements: [
      "The judged text and the questions asked about it are sent to LangWatch.",
      "They are not stored.",
      "Traces, prompts and datasets are never sent.",
    ],
  },
  {
    id: "managed_models",
    name: "Managed models",
    description:
      "Calls a model on LangWatch when you write it as langwatch/<model>, so this install needs no provider account for it.",
    dataStatements: [
      "The prompts and completions of calls you route to a langwatch model are sent to LangWatch.",
      "Calls to your own providers are unaffected and are never sent.",
      "Traces, prompts and datasets are never sent.",
    ],
  },
] as const satisfies readonly HostedService[];

/** A figure in United States dollars, or a plain statement that we have none. */
export function formatUsd(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value.toFixed(2)} USD`
    : "Not available";
}

/** The day a period started, written out, or `fallback` when there is none to write. */
export function formatPeriodStart({
  value,
  fallback,
}: {
  value: string | null | undefined;
  fallback: string;
}): string {
  if (!value) return fallback;
  try {
    return Temporal.Instant.from(value).toLocaleString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return fallback;
  }
}
