// ---------------------------------------------------------------------------
// @langwatch/contracts -- Public API
//
// One namespace per wire surface. Import the subpath (`@langwatch/contracts/
// agent-onboarding`) rather than the root when you only need one surface, so
// adding a second surface never grows an unrelated consumer's module graph.
// ---------------------------------------------------------------------------

export * as agentOnboarding from "./agent-onboarding/index.js";
