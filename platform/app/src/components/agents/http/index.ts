import type { HttpAuth, HttpHeader, HttpMethod } from "@langwatch/agent-contract";
import { useCallback } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

export {
  AuthConfigSection,
  type AuthConfigSectionProps,
  BodyTemplateEditor,
  type BodyTemplateEditorProps,
  HeadersConfigSection,
  type HeadersConfigSectionProps,
  HttpConfigEditor,
  type HttpConfigEditorProps,
  HttpMethodSelector,
  type HttpMethodSelectorProps,
  HttpTestPanel,
  type HttpTestPanelProps,
  type HttpTestResult,
  messagesToJson,
  OutputPathInput,
  type HttpOutputPathInputProps as OutputPathInputProps,
  type TestMessage,
  TestMessagesBuilder,
  type TestMessagesBuilderProps,
} from "@langwatch/agent-web/screens/agent-management";

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
  const mutation = api.httpProxy.execute.useMutation();

  const handleTest = useCallback(
    async (templateVariables: Record<string, unknown>) => {
      if (!project?.id) {
        return { success: false, error: "No project selected" };
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
