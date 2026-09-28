/**
 * Reading and formatting LangWatchQL rows for blocks. ClickHouse sends wide
 * integers as strings and an empty quantile as NaN, so every number read here
 * goes through {@link rowNumber}.
 */

import { format, toEpochMs } from "@langwatch/time";

import type { BlockUnit, BlockView } from "./block-definition.ts";

export type BlockRow = Readonly<Record<string, unknown>>;

/** Each named statement's rows. */
export type BlockRows = Readonly<Record<string, readonly BlockRow[]>>;

/** The page period a block reads over, in epoch milliseconds, and the grain it asked for. */
export interface BlockPeriod {
  readonly periodStart: number;
  readonly periodEnd: number;
  readonly granularitySeconds: number;
}

/**
 * Whether a block has anything to draw. A summary statement always answers
 * one row, zeros included, so those views read their count instead.
 */
export function blockHasData({ view, rows }: { view: BlockView; rows: BlockRows }): boolean {
  switch (view) {
    case "status":
      return rowNumber(rows.main?.[0], "requests") > 0;
    case "costEfficiency":
      return rowNumber(rows.summary?.[0], "traces") > 0;
    case "scenarios":
      return rowNumber(rows.summary?.[0], "runs") > 0;
    case "feedback": {
      const summary = rows.summary?.[0];
      return rowNumber(summary, "thumbs_up") + rowNumber(summary, "thumbs_down") > 0;
    }
    default:
      return Object.values(rows).some((answer) => answer.length > 0);
  }
}

/** A finite number from a row cell, or zero. */
export function rowNumber(row: BlockRow | undefined, key: string): number {
  const value = Number(row?.[key]);
  return Number.isFinite(value) ? value : 0;
}

/** An unknown cell value stringified without relying on its default toString. */
function stringifyUnknown(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return JSON.stringify(value);
}

/** A row cell as display text. */
export function rowText(row: BlockRow | undefined, key: string): string {
  return stringifyUnknown(row?.[key]);
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export function formatCount(value: number): string {
  return compact.format(value);
}

export function formatUsd(value: number): string {
  if (value !== 0 && Math.abs(value) < 1) return `$${value.toFixed(value < 0.01 ? 4 : 2)}`;
  return `$${compact.format(value)}`;
}

export function formatMs(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}s`;
  return `${Math.round(value)}ms`;
}

export function formatRatio(value: number, fractionDigits = 1): string {
  return `${(value * 100).toFixed(fractionDigits)}%`;
}

/** A signed percentage change, as the "vs prev" line reads it. */
export function formatDelta(delta: number): string {
  const sign = delta > 0 ? "+" : "";
  return `${sign}${(delta * 100).toFixed(0)}%`;
}

export function formatValue({ value, unit }: { value: number; unit: BlockUnit }): string {
  switch (unit) {
    case "usd":
      return formatUsd(value);
    case "ms":
      return formatMs(value);
    case "ratio":
      return formatRatio(value);
    case "score":
      return value.toFixed(2);
    case "tokens":
    case "count":
      return formatCount(value);
  }
}

/** A bucket instant as a short axis label; ClickHouse sends `YYYY-MM-DD hh:mm:ss` in UTC. */
export function formatBucket({
  value,
  granularitySeconds,
}: {
  value: unknown;
  granularitySeconds: number;
}): string {
  const text = stringifyUnknown(value);
  const iso = text.includes("T") ? text : `${text.replace(" ", "T")}Z`;
  const epochMs = toEpochMs(iso);
  if (Number.isNaN(epochMs)) return text;
  return format(epochMs, granularitySeconds >= 86_400 ? "MMM d" : "MMM d HH:mm");
}
