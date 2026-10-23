import { Card } from "@langwatch/design-system/card";
import {
  Box,
  Button,
  Heading,
  HStack,
  Spacer,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { HandledErrorAlert } from "@langwatch/error-views";
import { Plus } from "lucide-react";
import { useState } from "react";

import { api } from "../../../../behavior/ops-api.ts";
import { useSelfHostedNoticeCommands } from "../../behavior/use-self-hosted-notice-commands.ts";
import type { SelfHostedNoticeRow } from "../../model/self-hosted-notice.ts";
import { SelfHostedNoticesTable } from "../blocks/self-hosted-notices-table.tsx";
import { SelfHostedNoticeDrawer } from "./self-hosted-notice-drawer.tsx";

/**
 * Notices LangWatch sends every self-hosted install (self-hosted-notices.feature): a new release,
 * or a vulnerability fixed in one. A published notice reaches an install with Cloud's reply to its
 * next daily usage report, until it is withdrawn or stops showing.
 */
export function SelfHostedNoticesSection() {
  const [editing, setEditing] = useState<SelfHostedNoticeRow | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const list = api.selfHostedNotices.getAll.useQuery();
  const commands = useSelfHostedNoticeCommands();

  const openDrawer = (notice: SelfHostedNoticeRow | null) => {
    setEditing(notice);
    setDrawerOpen(true);
  };

  return (
    <VStack gap={4} width="full" align="start">
      <HStack width="full">
        <VStack align="start" gap={0}>
          <Heading size="sm">Self-hosted notices</Heading>
          <Text textStyle="sm" color="fg.muted">
            Shown on every self-hosted install after its next daily report.
          </Text>
        </VStack>
        <Spacer />
        <Button size="sm" variant="outline" onClick={() => openDrawer(null)}>
          <Plus size={16} />
          New notice
        </Button>
      </HStack>

      <Card padding="none">
        {list.error ? (
          <Box paddingY={10} paddingX={4}>
            <HandledErrorAlert error={list.error} fallbackTitle="Couldn't load notices" />
          </Box>
        ) : (
          <SelfHostedNoticesTable
            notices={list.data ?? []}
            isLoading={list.isLoading}
            isBusy={commands.publish.isPending || commands.withdraw.isPending}
            onEdit={openDrawer}
            onPublish={(notice) => commands.publish.mutate({ id: notice.id })}
            onWithdraw={(notice) => commands.withdraw.mutate({ id: notice.id })}
          />
        )}
      </Card>

      <SelfHostedNoticeDrawer
        open={drawerOpen}
        notice={editing}
        onClose={() => setDrawerOpen(false)}
      />
    </VStack>
  );
}
