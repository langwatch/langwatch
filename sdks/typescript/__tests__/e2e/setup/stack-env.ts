/**
 * Puts the stack the global setup resolved into this worker's environment,
 * before any test module reads `LANGWATCH_ENDPOINT` or `LANGWATCH_API_KEY`.
 */
import { readStackHandoff } from "./stack-handoff";
import { loadWorkspaceEnv } from "./workspace-env";

loadWorkspaceEnv();

const handoff = readStackHandoff();

if (handoff) {
  process.env.LANGWATCH_ENDPOINT = handoff.baseUrl;
  process.env.LANGWATCH_API_KEY = handoff.apiKey;
  process.env.LANGWATCH_E2E_ORGANIZATION_API_KEY = handoff.organizationApiKey;
  process.env.LANGWATCH_E2E_PROJECT_ID = handoff.projectId;
}
