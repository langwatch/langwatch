import {
  Badge,
  Box,
  Button,
  HStack,
  Separator,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";

import { Checkbox } from "~/components/ui/checkbox";
import { Link } from "~/components/ui/link";
import { toaster } from "~/components/ui/toaster";
import { api } from "~/utils/api";

type GuardrailDirectionEnum = "PRE" | "POST" | "STREAM_CHUNK";
type WireDirection = "pre" | "post" | "stream_chunk";

type GuardrailAttachment = { direction: WireDirection; guardrailIds: string[] };

const DIRECTION_ORDER: GuardrailDirectionEnum[] = ["PRE", "POST", "STREAM_CHUNK"];

const DIRECTION_META: Record<
  GuardrailDirectionEnum,
  { wire: WireDirection; label: string; hint: string }
> = {
  PRE: {
    wire: "pre",
    label: "Pre-request",
    hint: "Runs on the inbound prompt before it reaches the provider.",
  },
  POST: {
    wire: "post",
    label: "Post-response",
    hint: "Runs on the full completion before it returns to the caller.",
  },
  STREAM_CHUNK: {
    wire: "stream_chunk",
    label: "Stream chunk",
    hint: "Runs on each streamed chunk as it passes through.",
  },
};

function flattenAttachedIds(attachments: GuardrailAttachment[]): Set<string> {
  const set = new Set<string>();
  for (const a of attachments) {
    for (const id of a.guardrailIds) set.add(id);
  }
  return set;
}

/**
 * VK opt-in editor for project guardrails. Lists every GatewayGuardrail in
 * the VK's project grouped by direction; each row has a checkbox that
 * attaches/detaches the guardrail. The attachment direction is the
 * guardrail's own direction (a PRE guardrail can only attach on pre), so
 * the saved tuples regroup checked guardrails by their direction.
 *
 * Project-scoped: a VK with no single PROJECT scope has no guardrail
 * surface and renders an explanatory empty state.
 *
 * Spec: specs/ai-gateway/governance/guardrails-project-scope.feature
 *       — @vk-attach scenarios.
 */
export function GuardrailAttachmentsSection({
  organizationId,
  vkId,
  projectId,
  projectSlug,
  attachments,
  canAttach,
  onSaved,
}: {
  organizationId: string;
  vkId: string;
  projectId: string | null;
  projectSlug: string | null;
  attachments: GuardrailAttachment[];
  canAttach: boolean;
  onSaved: () => void;
}) {
  const serverAttachedIds = useMemo(
    () => flattenAttachedIds(attachments),
    [attachments],
  );
  const [checked, setChecked] = useState<Set<string>>(serverAttachedIds);

  useEffect(() => {
    setChecked(new Set(serverAttachedIds));
  }, [serverAttachedIds]);

  const guardrailsQuery = api.gatewayGuardrails.list.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId },
  );

  const updateMutation = api.virtualKeys.update.useMutation({
    onSuccess: () => {
      toaster.create({ title: "Guardrails updated", type: "success" });
      onSaved();
    },
    onError: (err) => {
      toaster.create({
        title: err.message.includes("missing_perm")
          ? "You don't have permission to attach guardrails in this project"
          : err.message,
        type: "error",
      });
    },
  });

  if (!projectId) {
    return (
      <SectionShell>
        <Text fontSize="sm" color="fg.muted">
          Guardrails are project-scoped. Scope this key to a single project to
          attach the project's guardrails.
        </Text>
      </SectionShell>
    );
  }

  if (guardrailsQuery.isLoading) {
    return (
      <SectionShell>
        <Spinner size="sm" />
      </SectionShell>
    );
  }

  const rows = guardrailsQuery.data ?? [];
  if (rows.length === 0) {
    return (
      <SectionShell>
        <Text fontSize="sm" color="fg.muted">
          No guardrails defined in this project yet.{" "}
          {projectSlug ? (
            <Link
              href="/settings/gateway/guardrails"
              color="blue.500"
              fontWeight="medium"
            >
              Create one
            </Link>
          ) : (
            "Create one from the Guardrails admin page"
          )}{" "}
          to attach it here.
        </Text>
      </SectionShell>
    );
  }

  const byDirection = DIRECTION_ORDER.map((dir) => ({
    dir,
    meta: DIRECTION_META[dir],
    rows: rows.filter((r) => r.direction === dir),
  })).filter((g) => g.rows.length > 0);

  const dirty =
    checked.size !== serverAttachedIds.size ||
    [...checked].some((id) => !serverAttachedIds.has(id));

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = () => {
    // Regroup checked guardrails by their own direction into wire tuples.
    const grouped = new Map<WireDirection, string[]>();
    for (const row of rows) {
      if (!checked.has(row.id)) continue;
      const wire = DIRECTION_META[row.direction as GuardrailDirectionEnum].wire;
      const list = grouped.get(wire) ?? [];
      list.push(row.id);
      grouped.set(wire, list);
    }
    const guardrailAttachments: GuardrailAttachment[] = [...grouped.entries()]
      .map(([direction, guardrailIds]) => ({ direction, guardrailIds }))
      .filter((a) => a.guardrailIds.length > 0);

    updateMutation.mutate({
      organizationId,
      id: vkId,
      config: { guardrailAttachments },
    });
  };

  return (
    <SectionShell>
      <VStack align="stretch" gap={4}>
        {byDirection.map(({ dir, meta, rows: dirRows }) => (
          <Box key={dir}>
            <HStack gap={2} mb={1}>
              <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
                {meta.label}
              </Text>
              <Text fontSize="xs" color="fg.subtle">
                {meta.hint}
              </Text>
            </HStack>
            <VStack align="stretch" gap={1.5}>
              {dirRows.map((row) => (
                <Checkbox
                  key={row.id}
                  checked={checked.has(row.id)}
                  disabled={!canAttach}
                  onCheckedChange={() => toggle(row.id)}
                >
                  <HStack gap={2}>
                    <Text fontSize="sm">{row.name}</Text>
                    {row.failureMode === "FAIL_CLOSED" ? (
                      <Badge size="sm" colorPalette="red" variant="subtle">
                        fail closed
                      </Badge>
                    ) : (
                      <Badge size="sm" colorPalette="gray" variant="subtle">
                        fail open
                      </Badge>
                    )}
                  </HStack>
                </Checkbox>
              ))}
            </VStack>
          </Box>
        ))}
        {!canAttach && (
          <Text fontSize="xs" color="fg.subtle">
            You need the gatewayGuardrails:attach permission in this project to
            change attachments.
          </Text>
        )}
        <HStack justifyContent="flex-end">
          <Button
            size="sm"
            colorPalette="blue"
            disabled={!canAttach || !dirty}
            loading={updateMutation.isPending}
            onClick={save}
          >
            Save guardrails
          </Button>
        </HStack>
      </VStack>
    </SectionShell>
  );
}

function SectionShell({ children }: { children: React.ReactNode }) {
  return (
    <Box>
      <Text fontSize="sm" fontWeight="semibold" mb={2}>
        Guardrails
      </Text>
      <Separator mb={3} />
      {children}
    </Box>
  );
}
