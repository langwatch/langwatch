/**
 * The model a prompt opens with when nothing else names one.
 *
 * A family-local copy of the one constant this screen reads out of
 * `platform/app/src/utils/constants.ts`, which has 75 other importers and
 * cannot be repointed while they exist. The value is derived rather than
 * restated: `@langwatch/model-provider-contract` publishes the flagship
 * lookup the application constant is built from, so the two cannot drift.
 */

import { getLatestOpenAIChatFlagship } from "@langwatch/model-provider-contract";

export const DEFAULT_MODEL = getLatestOpenAIChatFlagship() ?? "openai/gpt-5";
