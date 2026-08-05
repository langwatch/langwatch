import { assertPlatformHasNoLangwatchApiKey } from "./langwatchPlatformGuard";

// Side-effect module: importing it runs the platform self-reference guard. It is the
// VERY FIRST import in instrumentation.node.ts, so the platform refuses to boot before
// any OTel/langwatch module — or a future import-time side effect — can wire an
// exporter. Kept separate from langwatchPlatformGuard.ts so the pure function stays
// unit-testable without the ambient-process.env check firing merely on import.
assertPlatformHasNoLangwatchApiKey();
