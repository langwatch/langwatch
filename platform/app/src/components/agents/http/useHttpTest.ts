import { useCallback } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { HttpAuth, HttpHeader, HttpMethod } from "~/optimization_studio/types/dsl";
import { api } from "~/utils/api";
import type { HttpTestResult } from "./HttpTestPanel";

/**
 * Hook that provides an HTTP test handler using the httpProxy API.
 * Extracts the repeated test pattern from HttpPropertiesPanel, AgentPropertiesPanel,
 * and AgentHttpEditorDrawer.
 */
export function useHttpTest({
  url,
  method,
  headers,
  auth,
  outputPath,
}: {
  url: string;
  method: HttpMethod;
  headers: HttpHeader[];
  auth: HttpAuth | undefined;
  outputPath: string;
}) {
  const { project } = useOrganizationTeamProject();
  const httpProxyMutation = api.httpProxy.execute.useMutation();

  const handleTest = useCallback(
    async (requestBody: string): Promise<HttpTestResult> => {
      if (!project?.id) {
        return { success: false, error: "No project selected" };
      }

      try {
        const result = await httpProxyMutation.mutateAsync({
          projectId: project.id,
          url,
          method,
          headers: headers.map((h) => ({ key: h.key, value: h.value })),
          auth: auth
            ? {
                type: auth.type,
                token: auth.type === "bearer" ? auth.token : undefined,
                headerName: auth.type === "api_key" ? auth.header : undefined,
                apiKeyValue: auth.type === "api_key" ? auth.value : undefined,
                username: auth.type === "basic" ? auth.username : undefined,
                password: auth.type === "basic" ? auth.password : undefined,
              }
            : undefined,
          body: requestBody,
          outputPath,
        });

        return {
          success: result.success,
          response: result.response,
          extractedOutput: result.extractedOutput,
          error: result.error,
          status: result.status,
          duration: result.duration,
          responseHeaders: result.responseHeaders,
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : "Test request failed",
        };
      }
    },
    [project?.id, url, method, headers, auth, outputPath, httpProxyMutation],
  );

  return { handleTest, isPending: httpProxyMutation.isPending };
}
