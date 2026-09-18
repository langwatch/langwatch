/**
 * The model a prompt opens with when nothing else names one, family-local
 * (`platform/app`'s constant has 75 other importers). Derived, not restated:
 * `@langwatch/model-provider-contract`'s flagship lookup, so the two cannot drift.
 */

import { getLatestOpenAIChatFlagship } from "@langwatch/model-provider-contract";

export const DEFAULT_MODEL = getLatestOpenAIChatFlagship() ?? "openai/gpt-5";
