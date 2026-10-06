import { alignDevAuthUrlsToPort } from "@langwatch/config";

/**
 * The environment this process was started with, handed to the preamble: the one place the app
 * reads it. A development stack's own address is realigned onto its port first.
 */
export const processEnvironment: Readonly<Record<string, string | undefined>> =
  alignDevAuthUrlsToPort({ environment: process.env }).environment;
