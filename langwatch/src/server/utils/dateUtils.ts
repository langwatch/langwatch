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

