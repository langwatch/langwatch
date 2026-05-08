import {
  Badge,
  Box,
  Button,
  Dialog,
  HStack,
  Spacer,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Eye } from "lucide-react";
import { useState } from "react";

import { Link } from "~/components/ui/link";
import { api } from "~/utils/api";

/**
 * Admin readonly catalog view — second tab on /settings/governance/tool-catalog
 * per `specs/ai-gateway/governance/ingestion-templates-catalog.feature`
 * @admin-readonly scenario.
 *
 * v1 ships READ-ONLY. Admins consume + opt-out only. No Edit / Disable /
 * Fork buttons. The 'View OTTL' modal exists for transparency — admins
 * see what platform OTTL is shipped + can request a custom template
 * via docs link if their org needs different mapping.
 *
 * Org-authoring UI + per-org override-to-disable defer to v2.
 */
export function IngestionTemplatesEditor({
  organizationId,
}: {
  organizationId: string;
}) {
  const listQuery = api.ingestionTemplates.adminList.useQuery(
    { organizationId },
    { enabled: !!organizationId, refetchOnWindowFocus: false },
  );

  const [viewOttlSlug, setViewOttlSlug] = useState<string | null>(null);
  const viewOttlDetail = api.ingestionTemplates.get.useQuery(
    {
      organizationId,
      id:
        listQuery.data?.find((t) => t.slug === viewOttlSlug)?.id ??
        "",
    },
    {
      enabled: !!organizationId && !!viewOttlSlug,
      refetchOnWindowFocus: false,
    },
  );

  if (listQuery.isLoading) {
    return (
      <Box padding={6} textAlign="center">
        <Spinner size="sm" />
      </Box>
    );
  }

  const templates = listQuery.data ?? [];

  if (templates.length === 0) {
    return (
      <Box
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="md"
        padding={6}
        backgroundColor="bg.subtle"
      >
        <VStack align="start" gap={2}>
          <Text fontSize="sm" fontWeight="medium">
            No ingestion templates yet
          </Text>
          <Text fontSize="xs" color="fg.muted">
            Platform-default templates (claude_code, cursor, claude_cowork)
            will appear here once seeded. Org-authored templates land in v2.
          </Text>
        </VStack>
      </Box>
    );
  }

  return (
    <VStack align="stretch" gap={3} width="full">
      <Box
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="md"
        overflow="hidden"
      >
        <Table.Root size="sm">
          <Table.Header backgroundColor="bg.subtle">
            <Table.Row>
              <Table.ColumnHeader>Template</Table.ColumnHeader>
              <Table.ColumnHeader>Source</Table.ColumnHeader>
              <Table.ColumnHeader>Scope</Table.ColumnHeader>
              <Table.ColumnHeader>Status</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">OTTL</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {templates.map((t) => (
              <Table.Row key={t.id}>
                <Table.Cell>
                  <VStack align="start" gap={0}>
                    <Text fontSize="sm" fontWeight="medium">
                      {t.displayName}
                    </Text>
                    <Text fontSize="xs" color="fg.muted" fontFamily="mono">
                      {t.slug}
                    </Text>
                  </VStack>
                </Table.Cell>
                <Table.Cell>
                  <Text fontSize="xs" fontFamily="mono">
                    {t.sourceType}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  {t.platformPublished ? (
                    <Badge size="sm" variant="surface" colorPalette="blue">
                      Platform
                    </Badge>
                  ) : (
                    <Badge size="sm" variant="surface" colorPalette="purple">
                      Org-authored
                    </Badge>
                  )}
                </Table.Cell>
                <Table.Cell>
                  {t.enabled ? (
                    <Badge size="sm" variant="surface" colorPalette="green">
                      Enabled
                    </Badge>
                  ) : (
                    <Badge size="sm" variant="surface" colorPalette="gray">
                      Disabled
                    </Badge>
                  )}
                </Table.Cell>
                <Table.Cell textAlign="end">
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setViewOttlSlug(t.slug)}
                  >
                    <Eye size={12} /> View OTTL
                  </Button>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </Box>

      <HStack>
        <Spacer />
        <Text fontSize="xs" color="fg.muted">
          Need a custom template?{" "}
          <Link
            href="/docs/ai-governance/ingestion-templates"
            color="orange.600"
          >
            Request via docs
          </Link>
          .
        </Text>
      </HStack>

      <Dialog.Root
        open={!!viewOttlSlug}
        onOpenChange={(d) => {
          if (!d.open) setViewOttlSlug(null);
        }}
        size="lg"
      >
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>
                OTTL — {viewOttlSlug ?? ""}
              </Dialog.Title>
              <Dialog.CloseTrigger />
            </Dialog.Header>
            <Dialog.Body>
              <VStack align="stretch" gap={2}>
                <Text fontSize="xs" color="fg.muted">
                  Platform-authored OTTL transform. Applied at receive time
                  AFTER the receiver re-stamps the binding's authoritative
                  principal + provenance keys (19-key
                  protectedTemplateAttributeKeys closed list). Read-only v1.
                </Text>
                {viewOttlDetail.isLoading ? (
                  <Spinner size="sm" />
                ) : viewOttlDetail.data ? (
                  <Box
                    as="pre"
                    fontSize="xs"
                    fontFamily="mono"
                    whiteSpace="pre-wrap"
                    backgroundColor="bg.subtle"
                    padding={3}
                    borderRadius="sm"
                    borderWidth="1px"
                    borderColor="border.muted"
                    maxHeight="400px"
                    overflow="auto"
                  >
                    {viewOttlDetail.data.ottlRules || "(no OTTL rules)"}
                  </Box>
                ) : (
                  <Text fontSize="sm" color="fg.muted">
                    Template not found.
                  </Text>
                )}
              </VStack>
            </Dialog.Body>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>
    </VStack>
  );
}
