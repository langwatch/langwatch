/**
 * One insight in the timeline-shaped list: flat hairline row, the date inside the entry, the
 * verdict in words. Acting is the loud part: the tinted footer, or square buttons beside a
 * summary row.
 */

import { Box, Button, chakra, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { type InsightEntry, type InsightFolder, insightSnippet } from "@langwatch/insight-contract";
import {
  Check,
  Clock3,
  Copy,
  LayoutDashboard,
  type LucideIcon,
  MessageCircleMore,
  RotateCcw,
  ThumbsDown,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import {
  FILED_VIA_WORDS,
  insightValidity,
  insightWhen,
  TONE_PRESENTATION,
} from "../../model/insight-presentation.ts";
import { InsightBody } from "../elements/insight-body.tsx";
import { ToneBadge } from "../elements/tone-badge.tsx";

export type InsightDensity = "expanded" | "summary";

export type InsightRowActions = {
  onDone: () => void;
  onKeep: () => void;
  onRestore: () => void;
  onChat: () => void;
  onCopy: () => void;
  onNotUseful: () => void;
};

const VALIDITY_COLOR = { muted: "fg.subtle", warn: "yellow.fg", ok: "green.fg" } as const;

export function InsightRow({
  entry,
  folder,
  density,
  unread,
  now,
  actions,
  boardTrail,
  evidence,
}: {
  entry: InsightEntry;
  folder: InsightFolder;
  density: InsightDensity;
  unread: boolean;
  now: number;
  actions: InsightRowActions;
  /** "Board › Widget" for the pointer the insight carries; absent when it carries none. */
  boardTrail?: ReactNode;
  /** The replayed chart under the body, shown with the body. */
  evidence?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const expanded = density === "expanded" || open;
  const toggle = density === "summary" ? () => setOpen((current) => !current) : undefined;
  const validity = insightValidity({ entry, folder, now });

  return (
    <Box
      as="article"
      aria-label={entry.title}
      position="relative"
      paddingX={5}
      paddingY={4}
      opacity={folder === "archived" ? 0.65 : 1}
    >
      {unread && (
        <Box
          title="New"
          position="absolute"
          insetY={0}
          left={0}
          width="3px"
          background={TONE_PRESENTATION[entry.tone].color}
        />
      )}

      <HStack align="flex-start" gap={4}>
        <VStack align="stretch" gap={0} flex={1} minWidth={0}>
          <HStack gap={2}>
            <ToneBadge tone={entry.tone} />
            {entry.topic && (
              <Text
                fontSize="9.5px"
                fontWeight="semibold"
                letterSpacing="0.14em"
                textTransform="uppercase"
                color="fg.subtle"
              >
                {entry.topic}
              </Text>
            )}
            <Text marginLeft="auto" flexShrink={0} fontSize="10.5px" color="fg.subtle">
              {insightWhen({ entry, now })}
            </Text>
          </HStack>

          <Text
            as="h3"
            marginTop={2}
            fontSize="16.5px"
            lineHeight="snug"
            fontWeight="semibold"
            color="fg"
            cursor={toggle ? "pointer" : undefined}
            onClick={toggle}
          >
            {entry.title}
          </Text>

          <HStack
            marginTop={1}
            gap={1}
            rowGap={0.5}
            flexWrap="wrap"
            minWidth={0}
            fontSize="11px"
            color="fg.muted"
            data-testid="insight-origin"
          >
            {boardTrail && (
              <>
                <Box as="span" display="flex" flexShrink={0} color="fg.subtle">
                  <LayoutDashboard size={11.5} aria-hidden />
                </Box>
                {boardTrail}
                <Text as="span" color="fg.subtle" aria-hidden>
                  ·
                </Text>
              </>
            )}
            <Text as="span" color="fg.subtle">
              {FILED_VIA_WORDS[entry.filedVia]}
            </Text>
          </HStack>

          <Text marginTop={1} fontSize="10.5px" color={VALIDITY_COLOR[validity.tone]}>
            {validity.text}
          </Text>

          {expanded ? (
            <>
              <InsightBody body={entry.body} />
              {evidence}
            </>
          ) : (
            <Text
              marginTop={1.5}
              maxWidth="640px"
              lineClamp={2}
              fontSize="12px"
              lineHeight="tall"
              color="fg.muted"
              cursor="pointer"
              onClick={toggle}
            >
              {insightSnippet(entry)}
            </Text>
          )}
        </VStack>

        {density === "summary" && !open && folder !== "archived" && (
          <HStack gap={1.5} alignSelf="center" flexShrink={0}>
            {folder === "stale" ? (
              <>
                <SquareAction
                  icon={Clock3}
                  label="Relevant"
                  title="Still relevant"
                  onClick={actions.onKeep}
                />
                <SquareAction
                  icon={Check}
                  label="Done"
                  title="Mark done"
                  onClick={actions.onDone}
                />
              </>
            ) : (
              <>
                <SquareAction
                  icon={Check}
                  label="Done"
                  title="Mark done"
                  onClick={actions.onDone}
                />
                <SquareAction
                  icon={MessageCircleMore}
                  label="Chat"
                  title="Chat about it"
                  onClick={actions.onChat}
                />
              </>
            )}
          </HStack>
        )}
      </HStack>

      {expanded && (
        <HStack
          gap={2}
          marginX={-5}
          marginBottom={-4}
          marginTop={4}
          paddingX={5}
          paddingY={2.5}
          borderTopWidth="1px"
          borderColor="border.muted"
          background="bg.muted"
        >
          {folder === "stale" && (
            <FooterButton icon={Clock3} label="Still relevant" onClick={actions.onKeep} />
          )}
          {folder !== "archived" && (
            <FooterButton icon={Check} label="Mark done" onClick={actions.onDone} />
          )}
          {folder === "archived" && (
            <FooterButton icon={RotateCcw} label="Restore" onClick={actions.onRestore} />
          )}
          <FooterButton icon={MessageCircleMore} label="Chat about it" onClick={actions.onChat} />
          <FooterButton icon={Copy} label="Copy" onClick={actions.onCopy} />
          {folder !== "archived" && (
            <Button
              marginLeft="auto"
              size="xs"
              variant="ghost"
              color="fg.subtle"
              title="Not useful: tell Langy why"
              onClick={actions.onNotUseful}
            >
              <ThumbsDown size={12} aria-hidden />
              Not useful
            </Button>
          )}
        </HStack>
      )}
    </Box>
  );
}

function FooterButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button size="xs" variant="outline" background="bg.panel" onClick={onClick}>
      <Icon size={13} strokeWidth={2} aria-hidden />
      {label}
    </Button>
  );
}

/** Summaries mode: the action pair rides beside the row, icon over label. */
function SquareAction({
  icon: Icon,
  label,
  title,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <chakra.button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      display="flex"
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      gap={1}
      width="54px"
      height="54px"
      flexShrink={0}
      borderWidth="1px"
      borderColor="border"
      borderRadius="lg"
      background="bg.muted"
      color="fg.muted"
      cursor="pointer"
      _hover={{ borderColor: "accent.solid", color: "accent.fg", background: "accent.subtle" }}
    >
      <Icon size={15} strokeWidth={2} aria-hidden />
      <Text as="span" fontSize="9px" fontWeight="semibold">
        {label}
      </Text>
    </chakra.button>
  );
}
