/**
 * Returns the start of the current calendar month as a timestamp (ms)
 */
export const getCurrentMonthStartMs = (): number => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
};

/**
 * Returns the start of the current calendar month as a Date
 */
export const getCurrentMonthStart = (): Date => {
  return new Date(getCurrentMonthStartMs());
};

/**
 * Returns the start of the current calendar month as "YYYY-MM-DD".
 * Matches the date format used by ProjectDailyBillableEvents.
 */
export const getCurrentMonthStartDateString = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
};
