import { useCallback } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { HttpAuth, HttpHeader, HttpMethod } from "@langwatch/workflow-contract";
import { api } from "~/utils/api";
import type { HttpTestResult } from "./HttpTestPanel";

/**
 * Runs the agent against its endpoint the way an evaluation will.
 *
 * The body template and its variables are sent as they are configured, not as
 * a body rendered here: the workflow engine renders it, so what the endpoint
 * receives during a test is what it receives during a run. Shared by
 * HttpPropertiesPanel, AgentPropertiesPanel and AgentHttpEditorDrawer.
 */
export function useHttpTest({
  url,
  method,
  headers,
  auth,
  outputPath,
  bodyTemplate,
  timeoutMs,
}: {
  url: string;
  method: HttpMethod;
  headers: HttpHeader[];
  auth: HttpAuth | undefined;
  outputPath: string;
  bodyTemplate: string;
  timeoutMs?: number;
}) {
  const { project } = useOrganizationTeamProject();
  const httpProxyMutation = api.httpProxy.execute.useMutation();

  const handleTest = useCallback(
    async (templateVariables: Record<string, unknown>): Promise<HttpTestResult> => {
      if (!project?.id) {
        return { success: false, error: "No project selected" };
      }

      try {
        const result = await httpProxyMutation.mutateAsync({
          projectId: project.id,
          url,
          method,
          headers: headers.map((h) => ({ key: h.key, value: h.value })),
          auth,
          bodyTemplate,
          templateVariables,
          outputPath,
          timeoutMs,
        });

        return {
          success: result.success,
          response: result.response,
          extractedOutput: result.extractedOutput,
          error: result.error,
          errorCode: result.errorCode,
          status: result.status,
          statusText: result.statusText,
          duration: result.duration,
          responseHeaders: result.responseHeaders,
          renderedBody: result.renderedBody,
          warnings: result.warnings,
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : "Test request failed",
        };
      }
    },
    [
      project?.id,
      url,
      method,
      headers,
      auth,
      outputPath,
      bodyTemplate,
      timeoutMs,
      httpProxyMutation,
    ],
  );

  return { handleTest, isPending: httpProxyMutation.isPending };
}
