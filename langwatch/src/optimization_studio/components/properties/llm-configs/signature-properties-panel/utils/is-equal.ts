/**
 * Utility function to compare objects for equality
 * Used to determine if form values have changed
 */
export function isEqual(a: any, b: any) {
  return JSON.stringify(a, null, 2) === JSON.stringify(b, null, 2);
}