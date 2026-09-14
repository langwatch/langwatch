/** Render Date as naive-UTC timestamp literal for timezone-independent comparison in raw SQL. */
export const toPgTimestampUtc = (value: Date): string =>
  value.toISOString().slice(0, 23).replace("T", " ");
