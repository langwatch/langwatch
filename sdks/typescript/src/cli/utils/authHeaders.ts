/**
 * Auth headers for CLI commands that call the platform with a bare `fetch`. The client factory
 * reads the request-scoped project id for them; a hand-written `fetch` has to ask, or a
 * user-scoped key goes out with no project named and the command 401s.
 */

import { buildAuthHeaders, type LangWatchAuthHeaders } from "@/internal/api/auth";
import { scopedProjectId } from "@/internal/credentialContext";

export const cliAuthHeaders = ({ apiKey }: { apiKey: string }): LangWatchAuthHeaders =>
  buildAuthHeaders({ apiKey, projectId: scopedProjectId() });
