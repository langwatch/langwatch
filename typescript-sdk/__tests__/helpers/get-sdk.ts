/**
 * Returns the Langwatch SDK.
 * Useful since the import path is weird.
 *
 * @returns The Langwatch SDK
 */
export async function getLangwatchSDK() {
  return await import("../../dist/index.js");
}
