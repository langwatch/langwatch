// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { SourceType } from "../ingestionSourceCatalog";

/**
 * The environments an organization already told us about without ever being
 * asked for one.
 *
 * Nothing in the database is an environment yet. But two source types are
 * configured by naming one: a Copilot Studio source points at a Power Platform
 * environment, and a Genie source points at a Databricks workspace. Both
 * addresses ride on `parserConfig`, which the source router already sends to
 * the client with credentials stripped — so the list can be derived rather
 * than invented, and every row on it is a place an admin actually pointed us
 * at.
 *
 * Derived, never stored. That is why a discovered row carries the source that
 * revealed it: it is the only thing that explains why a row an admin never
 * created is on their screen, and the only place to go to change it.
 *
 * Spec: specs/ai-governance/dashboard/inventory-environments.feature
 */

export interface EnvironmentRow {
  id: string;
  name: string;
  description: string;
  /** ISO instant, or null when nothing records one. */
  createdIso: string | null;
  createdBy: string;
  /** The source this row was derived from; absent on a hand-added row. */
  discoveredFrom?: string;
  /** True only for the sample rows, so the table can badge them. */
  isSample?: boolean;
}

/** The subset of the source DTO this module reads. */
export interface EnvironmentSource {
  id: string;
  name: string;
  /** A plain string on the wire; looked up rather than narrowed. */
  sourceType: string;
  parserConfig?: Record<string, unknown> | null;
  createdAt?: Date | string | null;
}

/**
 * Which `parserConfig` key names an environment, per source type, and what a
 * row derived from it is called.
 *
 * A table rather than a chain of conditionals so a source type that starts
 * naming an environment is one line, and so the set of types that DO name one
 * can be read at a glance — which is the question anyone reading an
 * unexpectedly short Environments tab is asking.
 */
const ENVIRONMENT_KEYS = {
  copilot_studio_dataverse: {
    key: "environmentUrl",
    kind: "Power Platform environment",
  },
  databricks_genie: { key: "workspaceUrl", kind: "Databricks workspace" },
} satisfies Partial<Record<SourceType, { key: string; kind: string }>>;

/**
 * The entry for a source type, looked up rather than indexed: `sourceType`
 * arrives as a plain string off the wire and may name a type the catalog has
 * since retired, which contributes no environment rather than an error.
 */
function environmentKeyFor(
  sourceType: string,
): { key: string; kind: string } | undefined {
  return Object.hasOwn(ENVIRONMENT_KEYS, sourceType)
    ? ENVIRONMENT_KEYS[sourceType as keyof typeof ENVIRONMENT_KEYS]
    : undefined;
}

/**
 * The readable name of an environment address.
 *
 * The host alone, because the rest of the address is the same for every
 * environment a customer has and the host is the part that differs. A value
 * that will not parse as a URL is shown as it was typed rather than dropped:
 * an admin who mistyped one needs to see the row to find the mistake.
 */
export function environmentName(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

function isoOf(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * Every environment the configured sources name, in the order the sources
 * arrived.
 *
 * The order is the caller's, not this function's. It used to say "oldest
 * source first", which it has never done — nothing here reads `createdAt` for
 * anything but the row's own timestamp. Sorting is the table's business, and
 * saying so is cheaper than a sort nobody asked for.
 *
 * A source type with no environment key contributes nothing, and so does one
 * whose key is empty — that is a source mid-configuration, not an environment.
 * Two sources pointed at the same address collapse to one row, because they
 * are one environment: showing it twice would double a customer's estate on
 * screen.
 */
export function discoverEnvironments({
  sources,
}: {
  sources: readonly EnvironmentSource[];
}): EnvironmentRow[] {
  const byAddress = new Map<string, EnvironmentRow>();
  for (const source of sources) {
    const entry = environmentKeyFor(source.sourceType);
    if (!entry) continue;
    const raw = source.parserConfig?.[entry.key];
    if (typeof raw !== "string" || raw.trim() === "") continue;
    const address = raw.trim().replace(/\/+$/, "");
    if (byAddress.has(address)) continue;
    byAddress.set(address, {
      id: `discovered:${address}`,
      name: environmentName(address),
      description: entry.kind,
      createdIso: isoOf(source.createdAt),
      createdBy: "Discovered automatically",
      discoveredFrom: source.name,
    });
  }
  return [...byAddress.values()];
}

/**
 * What the tab shows when nothing is connected and the reader asked for
 * sample data. Invented, and badged as such wherever it renders.
 */
export const SAMPLE_ENVIRONMENTS: EnvironmentRow[] = [
  {
    id: "sample-production",
    name: "Production",
    description: "Customer-facing agents and assistants",
    createdIso: "2026-01-14T09:20:00.000Z",
    createdBy: "Ana Ruiz",
    isSample: true,
  },
  {
    id: "sample-staging",
    name: "Staging",
    description: "Pre-release testing for agent changes",
    createdIso: "2026-02-02T15:45:00.000Z",
    createdBy: "Ana Ruiz",
    isSample: true,
  },
  {
    id: "sample-sandbox",
    name: "Sandbox",
    description: "Experiments, spikes and demos",
    createdIso: "2026-03-19T11:05:00.000Z",
    createdBy: "Tom Beck",
    isSample: true,
  },
];
