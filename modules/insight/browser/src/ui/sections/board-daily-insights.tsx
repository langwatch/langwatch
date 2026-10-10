/**
 * "Daily insights" in a board's header, lent through analytics' board-header extension point
 * (§10.1). A personal setting: none yet (a quiet switch, and the offer), off (the quiet
 * switch), or on (one dropdown with the schedule, the last run, Insights and the settings).
 */

import type { BoardHeaderActionProps } from "@langwatch/analytics-client";
import { Popover } from "@langwatch/design-system/popover";
import { Box, Button, chakra, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { Switch } from "@langwatch/design-system/switch";
import type { InsightDailyRunSetting, InsightRunSettings } from "@langwatch/insight-contract";
import { nowInstant } from "@langwatch/time";
import { ChevronDown, Inbox, Settings2 } from "lucide-react";
import { type ReactNode, useState } from "react";

import { useBoardDailyInsights } from "../../behavior/use-board-daily-insights.ts";
import { useInsightInbox } from "../../behavior/use-insight-inbox.ts";
import {
  lastRunWords,
  scheduleWords,
  shouldOfferDailyInsights,
  TEMPLATE_BOARD_NOTE,
} from "../../model/daily-run.ts";
import { useInsightHost } from "../../model/insight-host.ts";
import { DailyInsightsDialog } from "./daily-insights-dialog.tsx";

/** Keyed by board: a page that moves to another board starts a new visit. */
export function BoardDailyInsights(props: BoardHeaderActionProps) {
  return <DailyInsightsControl key={`${props.boardKind}:${props.boardId}`} {...props} />;
}

function DailyInsightsControl({
  boardKind,
  boardId,
  boardName,
  widgetCount,
}: BoardHeaderActionProps) {
  const daily = useBoardDailyInsights({ board: { kind: boardKind, id: boardId, name: boardName } });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [offerClosed, setOfferClosed] = useState(false);
  // The board asks as it opened: not later in the visit, when its first widget lands.
  const [widgetCountAtOpen, setWidgetCountAtOpen] = useState(widgetCount);
  if (widgetCountAtOpen === undefined && widgetCount !== undefined) {
    setWidgetCountAtOpen(widgetCount);
  }

  const { setting, settings } = daily;
  const note = boardKind === "template" ? TEMPLATE_BOARD_NOTE : undefined;
  if (!daily.available || !setting) return null;
  const isOn = setting.state === "on";
  // Turning it on here would promise a run that has nothing to read.
  if (!isOn && (widgetCount ?? 0) === 0) return null;

  const offering = shouldOfferDailyInsights({
    state: setting.state,
    widgetCountAtOpen,
    closedThisVisit: offerClosed,
  });

  return (
    <>
      {isOn ? (
        <DailyInsightsDropdown
          boardId={boardId}
          isEmpty={widgetCount === 0}
          settings={settings}
          lastRun={setting.lastRun}
          insightsHref={daily.insightsHref}
          onTurnOff={daily.turnOff}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      ) : (
        <Switch
          size="sm"
          checked={false}
          onCheckedChange={() => daily.turnOn(settings)}
          inputProps={{ "aria-label": "Turn on daily insights" }}
        >
          <Text as="span" fontSize="12px" fontWeight="normal" color="fg.muted">
            Daily insights
          </Text>
        </Switch>
      )}
      {offering && (
        <DailyInsightsDialog
          boardName={boardName}
          settings={settings}
          ownTimezone={daily.ownTimezone}
          note={note}
          offer={{ onDecline: daily.decline }}
          onSubmit={daily.turnOn}
          onClose={() => setOfferClosed(true)}
        />
      )}
      {settingsOpen && (
        <DailyInsightsDialog
          boardName={boardName}
          settings={settings}
          ownTimezone={daily.ownTimezone}
          note={note}
          onSubmit={(next) => {
            setSettingsOpen(false);
            daily.save(next);
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </>
  );
}

/** The control of a board that is on: one button with one short tag, and the rest inside. */
function DailyInsightsDropdown({
  boardId,
  isEmpty,
  settings,
  lastRun,
  insightsHref,
  onTurnOff,
  onOpenSettings,
}: {
  boardId: string;
  /** The board lost its last widget: the run stays on and waits for one. */
  isEmpty: boolean;
  settings: InsightRunSettings;
  lastRun: InsightDailyRunSetting["lastRun"];
  insightsHref: string | undefined;
  onTurnOff: () => void;
  onOpenSettings: () => void;
}) {
  const host = useInsightHost();
  const { inbox } = useInsightInbox();
  const [open, setOpen] = useState(false);
  // Read when the dropdown opens, so "today" is the day the reader looks.
  const [now, setNow] = useState(() => nowInstant().epochMilliseconds);
  // The control counts this board's own insights; Insights, where it leads, shows every board's.
  const unread = inbox?.unseen.filter((entry) => entry.board?.id === boardId).length ?? 0;
  const news = unread > 0 ? `${unread} new` : "nothing new";
  const status = isEmpty ? "waiting for a widget" : news;
  const leave = (then: () => void) => {
    setOpen(false);
    then();
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={({ open: isOpen }) => {
        if (isOpen) setNow(nowInstant().epochMilliseconds);
        setOpen(isOpen);
      }}
      positioning={{ placement: "bottom-end" }}
    >
      <Popover.Trigger asChild>
        <Button
          variant="outline"
          aria-label={`Daily insights: on, ${status}`}
          title={`Daily insights: on, ${status}`}
          height={8}
          paddingX={2.5}
          gap={1.5}
          borderRadius="lg"
          borderColor="border"
          fontSize="12px"
          fontWeight="normal"
          color="fg.muted"
          _hover={{ borderColor: "border.emphasized", color: "fg" }}
        >
          <Box as="span" color="accent.fg">
            <Inbox size={13} aria-hidden />
          </Box>
          Daily insights
          {isEmpty && <Tag>waiting</Tag>}
          {!isEmpty && unread > 0 && <Tag isNews>{unread} new</Tag>}
          <Box as="span" color="fg.subtle">
            <ChevronDown size={12} aria-hidden />
          </Box>
        </Button>
      </Popover.Trigger>
      <Popover.Content width="300px" padding={0}>
        <VStack align="stretch" gap={1.5} paddingX={4} paddingTop={3.5} paddingBottom={3}>
          <HStack justify="space-between" gap={3}>
            <Text fontSize="13px" fontWeight="semibold">
              Daily insights
            </Text>
            <Switch
              size="sm"
              checked
              onCheckedChange={() => leave(onTurnOff)}
              inputProps={{ "aria-label": "Turn off daily insights" }}
            />
          </HStack>
          <Text fontSize="11.5px" lineHeight="relaxed" color="fg.muted">
            {scheduleWords({ settings, hasWidgets: !isEmpty })}
          </Text>
          {/* A run that filed nothing says so, and why. */}
          <Text fontSize="11.5px" lineHeight="relaxed" color="fg.muted">
            {lastRunWords({ lastRun, now, timezone: settings.timezone })}
          </Text>
        </VStack>
        <VStack align="stretch" gap={0} borderTopWidth="1px" borderColor="border" padding={1.5}>
          {insightsHref !== undefined && (
            <MenuRow
              icon={<Inbox size={13} aria-hidden />}
              onClick={() => leave(() => host.navigate(insightsHref))}
            >
              Open Insights
            </MenuRow>
          )}
          <MenuRow icon={<Settings2 size={13} aria-hidden />} onClick={() => leave(onOpenSettings)}>
            Settings
          </MenuRow>
        </VStack>
      </Popover.Content>
    </Popover.Root>
  );
}

/** One short tag, so the control stays narrow: the dropdown says the rest. */
function Tag({ isNews = false, children }: { isNews?: boolean; children: ReactNode }) {
  return (
    <Box
      as="span"
      borderRadius="full"
      paddingX={1.5}
      paddingY="1px"
      fontSize="10.5px"
      {...(isNews
        ? { fontWeight: "semibold", color: "accent.fg", background: "accent.subtle" }
        : { color: "fg.muted", background: "bg.muted" })}
    >
      {children}
    </Box>
  );
}

function MenuRow({
  icon,
  onClick,
  children,
}: {
  icon: ReactNode;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <chakra.button
      type="button"
      onClick={onClick}
      display="flex"
      alignItems="center"
      gap={2}
      width="full"
      borderRadius="md"
      paddingX={2}
      paddingY={1.5}
      textAlign="left"
      fontSize="12.5px"
      cursor="pointer"
      _hover={{ background: "bg.muted" }}
    >
      <Box as="span" flexShrink={0} color="fg.muted">
        {icon}
      </Box>
      {children}
    </chakra.button>
  );
}
