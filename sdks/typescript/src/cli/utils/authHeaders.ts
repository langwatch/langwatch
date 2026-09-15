/**
 * Auth headers for the CLI commands that call the platform with a bare
 * `fetch` instead of the generated API client.
 *
 * The client factory reads the request-scoped project id for them
 * (internal/api/client.ts); a hand-written `fetch` has to ask. Without it a
 * user-scoped login key goes out as a bare Bearer with no project named, the
 * server cannot resolve the role binding, and the command 401s while the same
 * command through the API client works.
 */

import { buildAuthHeaders, type LangWatchAuthHeaders } from "@/internal/api/auth";
import { scopedProjectId } from "@/internal/credentialContext";

export const cliAuthHeaders = ({ apiKey }: { apiKey: string }): LangWatchAuthHeaders =>
  buildAuthHeaders({ apiKey, projectId: scopedProjectId() });
