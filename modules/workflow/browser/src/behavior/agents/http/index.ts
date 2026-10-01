import {
  httpAgentTestInputSchema,
  type HttpAuth,
  type HttpHeader,
  type HttpMethod,
} from "@langwatch/agent-contract";
import { useCallback } from "react";

import { useOrganizationTeamProject } from "../../studio-host/use-organization-team-project.ts";
import { workflowApi } from "../../workflow-api.ts";

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
  const mutation = workflowApi.httpProxy.execute.useMutation();

  const handleTest = useCallback(
    async (templateVariables: Record<string, unknown>) => {
      if (!project?.id) {
        return { success: false, error: "No project selected" };
      }

      const variables =
        httpAgentTestInputSchema.shape.templateVariables.safeParse(templateVariables);
      if (!variables.success) {
        return { success: false, error: "Template variables must be valid JSON values" };
      }

      try {
        const result = await mutation.mutateAsync({
          projectId: project.id,
          url,
          method,
          headers: headers.map((header) => ({
            key: header.key,
            value: header.value,
          })),
          auth,
          bodyTemplate,
          templateVariables: variables.data,
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
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Test request failed",
        };
      }
    },
    [auth, bodyTemplate, headers, method, mutation, outputPath, project?.id, timeoutMs, url],
  );

  return { handleTest, isPending: mutation.isPending };
}
