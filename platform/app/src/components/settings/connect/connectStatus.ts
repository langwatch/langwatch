/**
 * What the Connect settings page reads, and the hosted services it lists.
 *
 * The view types come from the router itself, so the page and the install's
 * own answer cannot drift apart.
 *
 * Spec: specs/self-hosting/connected-services/connect-settings.feature
 */

import type { ConnectService } from "@ee/licensing/connect/services";
import type { RouterOutputs } from "~/utils/api";

export type ConnectStatusView = RouterOutputs["connect"]["status"];

/** The state of an install where Connect is switched on for the deployment. */
export type ConnectEnabledView = Extract<
  ConnectStatusView,
  { deployment: "on" }
>;

export type ConnectUsageView = NonNullable<ConnectEnabledView["usage"]>;
export type ConnectContractView = NonNullable<ConnectUsageView["contract"]>;

export interface HostedService {
  /** The name the license uses for the service. */
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

/** The day a spend period started, written out. */
export function formatPeriodStart(
  value: string | Date | null | undefined,
): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
