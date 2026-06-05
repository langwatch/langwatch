import { Box, HStack, Spinner, Table, Text, VStack } from "@chakra-ui/react";

import { Switch } from "~/components/ui/switch";
import { toaster } from "~/components/ui/toaster";
import { api } from "~/utils/api";

/**
 * Admin editor for the per-tool CLI path policy. Each unified coding
 * assistant the `langwatch <tool>` wrapper supports can route two ways:
 *
 *   - Gateway (Path A): the tool talks to the LangWatch gateway through the
 *     user's personal virtual key.
 *   - OTLP direct (Path B): the tool exports telemetry straight to the
 *     personal OTLP endpoint with an ingestion binding token.
 *
 * Toggling a path off here tells the CLI (which caches this map at login) to
 * stop offering that path. Defaults preserve current behavior, so a row only
 * diverges once an admin flips a switch.
 *
 * Spec: specs/ai-gateway/governance/cli-tool-mode-policy.feature
 */

const TOOL_LABELS: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
  opencode: "OpenCode",
  cursor: "Cursor",
};

const TOOL_ORDER = ["claude", "codex", "gemini", "opencode", "cursor"] as const;

export function ToolPathPolicyEditor({
  organizationId,
}: {
  organizationId: string;
}) {
  const utils = api.useUtils();
  const policiesQuery = api.platformToolPolicy.list.useQuery({ organizationId });

  const updateMutation = api.platformToolPolicy.update.useMutation({
    onSuccess: () => {
      void utils.platformToolPolicy.list.invalidate({ organizationId });
    },
    onError: (error) => {
      toaster.create({
        title: "Could not update the path policy",
        description: error.message,
        type: "error",
      });
      // Roll the optimistic toggle back to the server's truth.
      void utils.platformToolPolicy.list.invalidate({ organizationId });
    },
  });

  if (policiesQuery.isLoading) {
    return (
      <HStack gap={2} color="fg.muted" paddingY={4}>
        <Spinner size="sm" />
        <Text fontSize="sm">Loading path policy...</Text>
      </HStack>
    );
  }

  if (policiesQuery.error || !policiesQuery.data) {
    return (
      <Text color="red.500" fontSize="sm">
        Could not load the path policy: {policiesQuery.error?.message}
      </Text>
    );
  }

  const policies = policiesQuery.data;

  return (
    <VStack align="stretch" gap={4} width="full">
      <Text color="fg.muted" fontSize="sm">
        Choose which paths each <code>langwatch &lt;tool&gt;</code> command may
        use. The CLI caches this at login and only offers the paths you allow.
        Turning a path off does not affect tools your members have already
        configured until they sign in again.
      </Text>

      <Table.Root size="sm" variant="line">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>Tool</Table.ColumnHeader>
            <Table.ColumnHeader>Gateway (virtual key)</Table.ColumnHeader>
            <Table.ColumnHeader>Direct OTLP ingestion</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {TOOL_ORDER.map((slug) => {
            const policy = policies[slug];
            const pending =
              updateMutation.isPending &&
              updateMutation.variables?.toolSlug === slug;
            return (
              <Table.Row key={slug}>
                <Table.Cell>
                  <Text fontWeight="medium">{TOOL_LABELS[slug] ?? slug}</Text>
                </Table.Cell>
                <Table.Cell>
                  <Switch
                    checked={policy.allowVk}
                    disabled={pending}
                    onCheckedChange={({ checked }) =>
                      updateMutation.mutate({
                        organizationId,
                        toolSlug: slug,
                        allowVk: checked,
                      })
                    }
                  />
                </Table.Cell>
                <Table.Cell>
                  <Switch
                    checked={policy.allowOtelDirect}
                    disabled={pending}
                    onCheckedChange={({ checked }) =>
                      updateMutation.mutate({
                        organizationId,
                        toolSlug: slug,
                        allowOtelDirect: checked,
                      })
                    }
                  />
                </Table.Cell>
              </Table.Row>
            );
          })}
        </Table.Body>
      </Table.Root>

      <Box>
        <Text color="fg.muted" fontSize="xs">
          Cursor is GUI-only, so direct OTLP is off by default. A tool with both
          paths off refuses to run and asks the member to contact an admin.
        </Text>
      </Box>
    </VStack>
  );
}
