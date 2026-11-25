/**
 * Auth headers for CLI commands that call the platform with a bare `fetch`. The client factory
 * reads the request-scoped project id for them; a hand-written `fetch` has to ask, or a
 * user-scoped key goes out with no project named and the command 401s.
 */

import { buildRequestHeaders } from "@/internal/api/request-headers";
import { scopedProjectId } from "@/internal/credentialContext";

export const cliAuthHeaders = ({ apiKey }: { apiKey: string }): Record<string, string> =>
  buildRequestHeaders({ apiKey, projectId: scopedProjectId() });
