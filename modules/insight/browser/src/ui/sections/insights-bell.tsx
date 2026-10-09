/**
 * The topbar bell, lent through `InsightsBellToken` (§10.1): what you have not seen, from the
 * same derivation as the page and the sidebar. Draws nothing without a project, the flag or
 * the grant.
 */

import { Popover } from "@langwatch/design-system/popover";
import { Box, chakra, HStack, IconButton, Text, VStack } from "@langwatch/design-system/primitives";
import type { InsightsBellProps } from "@langwatch/insight-contract";
import { Bell } from "lucide-react";
import { useState } from "react";

import { useInsightInbox } from "../../behavior/use-insight-inbox.ts";
import { useInsightHost } from "../../model/insight-host.ts";
import { insightDay } from "../../model/insight-presentation.ts";
import { ToneDot } from "../elements/tone-badge.tsx";
import { UnreadPill } from "../elements/unread-pill.tsx";

const NEW_INSIGHTS_SHOWN = 4;

export function InsightsBell(_props: InsightsBellProps) {
  const host = useInsightHost();
  const reading = useInsightInbox();
  const [open, setOpen] = useState(false);
  if (!reading.available || !reading.project) return null;
  const inboxHref = `/${reading.project.slug}/insights`;
  const unseen = reading.inbox?.unseen ?? [];
  const go = (to: string) => {
    setOpen(false);
    host.navigate(to);
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={({ open: isOpen }) => setOpen(isOpen)}
      positioning={{ placement: "bottom-end" }}
    >
      <Popover.Trigger asChild>
        <IconButton
          aria-label="Inbox: new insights"
          title="Inbox: new insights"
          size="sm"
          variant="ghost"
          color="fg.muted"
          position="relative"
        >
          <Bell size={16} />
          {reading.inbox && reading.inbox.count > 0 && (
            <Box position="absolute" top="-2px" right="-4px">
              <UnreadPill count={reading.inbox.count} tone={reading.inbox.tone} size="xs" />
            </Box>
          )}
        </IconButton>
      </Popover.Trigger>
      <Popover.Content width="400px" padding={0}>
        <Box borderBottomWidth="1px" borderColor="border" paddingX={4} paddingY={2.5}>
          <Text fontSize="12.5px" fontWeight="semibold">
            Inbox{" "}
            <Text as="span" fontWeight="normal" color="fg.subtle">
              · this project
            </Text>
          </Text>
        </Box>
        <Box maxHeight="420px" overflowY="auto">
          {unseen.length > 0 ? (
            <VStack align="stretch" gap={0} paddingBottom={1}>
              <Text
                paddingX={4}
                paddingTop={2}
                paddingBottom={1}
                fontSize="10px"
                fontWeight="semibold"
                letterSpacing="0.08em"
                textTransform="uppercase"
                color="fg.subtle"
              >
                New insights
              </Text>
              {unseen.slice(0, NEW_INSIGHTS_SHOWN).map((entry) => (
                <chakra.button
                  key={entry.id}
                  type="button"
                  onClick={() => go(inboxHref)}
                  display="flex"
                  alignItems="center"
                  gap={2.5}
                  width="full"
                  paddingX={4}
                  paddingY={2}
                  textAlign="left"
                  cursor="pointer"
                  _hover={{ background: "accent.subtle" }}
                >
                  <ToneDot tone={entry.tone} />
                  <Text as="span" flex={1} minWidth={0} truncate fontSize="12.5px">
                    {entry.title}
                  </Text>
                  <Text as="span" flexShrink={0} fontSize="10px" color="fg.subtle">
                    {insightDay(entry)}
                  </Text>
                </chakra.button>
              ))}
            </VStack>
          ) : (
            <Text paddingX={4} paddingY={8} textAlign="center" fontSize="12px" color="fg.subtle">
              All caught up.
            </Text>
          )}
        </Box>
        <HStack borderTopWidth="1px" borderColor="border">
          <chakra.button
            type="button"
            onClick={() => go(inboxHref)}
            width="full"
            paddingX={4}
            paddingY={2.5}
            textAlign="left"
            fontSize="12px"
            fontWeight="medium"
            color="accent.fg"
            cursor="pointer"
            _hover={{ background: "accent.subtle" }}
          >
            Open inbox
          </chakra.button>
        </HStack>
      </Popover.Content>
    </Popover.Root>
  );
}
