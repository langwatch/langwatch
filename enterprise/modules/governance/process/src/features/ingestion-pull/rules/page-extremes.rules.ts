// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The smallest and largest of a pulled page's numbers, by loop. `Math.min(...values)`
 * passes every value as an argument, and a page past about 120,000 of them throws a
 * RangeError (call stack size exceeded).
 */
export function earliestOf(values: readonly number[]): number {
  return values.reduce((low, value) => (value < low ? value : low), Infinity);
}

export function latestOf(values: readonly number[]): number {
  return values.reduce((high, value) => (value > high ? value : high), -Infinity);
}
