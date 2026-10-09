/**
 * The Insights inbox. What people read is timeline-shaped, what they act on is inbox-shaped:
 * a few insights, judged good or bad, that drop to Stale once they stop being true and to
 * Archived once marked done. Folders, seen and done are each reader's own.
 * @see modules/insight/specs/insight-inbox.feature
 */

import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { PageLayout } from "@langwatch/design-system/page-layout";
import {
  Box,
  Button,
  HStack,
  Skeleton,
  Spacer,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { SegmentedControl } from "@langwatch/design-system/segmented-control";
import {
  INSIGHT_FOLDERS,
  type InsightEntry,
  type InsightFolder,
  type InsightInbox,
} from "@langwatch/insight-contract";
import { Inbox } from "lucide-react";
import { useState } from "react";

import { useInsightActions, useMarkShownSeen } from "../../behavior/use-insight-actions.ts";
import { useInsightInbox } from "../../behavior/use-insight-inbox.ts";
import { useInsightHost } from "../../model/insight-host.ts";
import { type FolderCount, FolderRail } from "../blocks/folder-rail.tsx";
import { type InsightDensity, InsightRow } from "../blocks/insight-row.tsx";

const HINT = "Langy's brief: a few things worth acting on, kept fresh, never a feed.";

const EMPTY_FOLDER_COPY: Record<InsightFolder, string> = {
  inbox: "Inbox zero. Langy files only what deserves attention.",
  stale: "Nothing stale. Everything here is either fresh or done.",
  archived: "Nothing archived yet. Mark done moves insights here.",
};

function folderOf(value: string | undefined): InsightFolder {
  return INSIGHT_FOLDERS.find((folder) => folder === value) ?? "inbox";
}

export default function InsightsScreen() {
  const host = useInsightHost();
  const reading = useInsightInbox();
  const [folder, setFolder] = useState<InsightFolder>(() => folderOf(host.query().folder));
  const [density, setDensity] = useState<InsightDensity>("expanded");

  const selectFolder = (next: InsightFolder) => {
    setFolder(next);
    host.setQuery({ folder: next === "inbox" ? undefined : next });
  };

  return (
    <>
      <PageLayout.Header>
        <PageLayout.Heading>Insights</PageLayout.Heading>
        <Spacer />
        <SegmentedControl
          size="xs"
          aria-label="Density"
          value={density}
          onValueChange={({ value }) => setDensity(value === "summary" ? "summary" : "expanded")}
          items={[
            { value: "expanded", label: "Expanded" },
            { value: "summary", label: "Summaries" },
          ]}
        />
      </PageLayout.Header>
      <PageLayout.Container paddingTop={4}>
        <Text fontSize="13px" color="fg.muted" marginBottom={5}>
          {HINT}
        </Text>
        <InboxBody
          reading={reading}
          folder={folder}
          density={density}
          onSelectFolder={selectFolder}
        />
      </PageLayout.Container>
    </>
  );
}

function InboxBody({
  reading,
  folder,
  density,
  onSelectFolder,
}: {
  reading: ReturnType<typeof useInsightInbox>;
  folder: InsightFolder;
  density: InsightDensity;
  onSelectFolder: (folder: InsightFolder) => void;
}) {
  const host = useInsightHost();
  if (reading.error) {
    return (
      <VStack align="start" gap={2} paddingY={6}>
        <Text fontSize="13px" color="fg.muted">
          The inbox didn't load.
        </Text>
        <Button size="xs" variant="outline" onClick={reading.retry}>
          Retry
        </Button>
      </VStack>
    );
  }
  if (!reading.inbox || !reading.project) return <InboxSkeleton />;
  const { inbox } = reading;
  if (inbox.inbox.length + inbox.stale.length + inbox.archived.length === 0) {
    return (
      <NoDataInfoBlock
        title="Langy writes your brief here"
        description="Save a Langy answer as an insight and it lands here: judged good or bad news, kept until it stops being true, with the whole team reading the same brief."
        icon={<Inbox size={24} />}
        testId="insights-day-zero"
      >
        <Button size="sm" variant="outline" onClick={() => host.askLangy({ draft: "" })}>
          Open Langy
        </Button>
      </NoDataInfoBlock>
    );
  }
  return (
    <FolderView
      inbox={inbox}
      projectId={reading.project.id}
      now={reading.now}
      folder={folder}
      density={density}
      onSelectFolder={onSelectFolder}
    />
  );
}

function FolderView({
  inbox,
  projectId,
  now,
  folder,
  density,
  onSelectFolder,
}: {
  inbox: InsightInbox;
  projectId: string;
  now: number;
  folder: InsightFolder;
  density: InsightDensity;
  onSelectFolder: (folder: InsightFolder) => void;
}) {
  const host = useInsightHost();
  const actions = useInsightActions({ projectId });
  // The dots you came to see stay for this visit, even after the visit marks them seen.
  const [unreadThisVisit] = useState(
    () => new Set([...inbox.inbox, ...inbox.stale].filter(isUnseen).map((entry) => entry.id)),
  );
  const shown = inbox[folder];
  useMarkShownSeen({ projectId, insightIds: shown.filter(isUnseen).map((entry) => entry.id) });

  const counts: Record<InsightFolder, FolderCount> = {
    inbox: { count: inbox.inbox.length, hot: inbox.unseen.length > 0 },
    stale: { count: inbox.stale.length, hot: false },
    archived: { count: inbox.archived.length, hot: false },
  };

  return (
    <HStack align="flex-start" gap={6} width="full">
      <FolderRail active={folder} counts={counts} onSelect={onSelectFolder} />
      <Box flex={1} minWidth={0}>
        {shown.length === 0 ? (
          <Text paddingX={4} paddingY={14} textAlign="center" fontSize="12.5px" color="fg.subtle">
            {EMPTY_FOLDER_COPY[folder]}
          </Text>
        ) : (
          <VStack
            align="stretch"
            gap={0}
            divideY="1px"
            divideColor="border.muted"
            borderYWidth="1px"
            borderColor="border"
            background="bg.panel"
          >
            {shown.map((entry) => (
              <InsightRow
                key={entry.id}
                entry={entry}
                folder={folder}
                density={density}
                unread={unreadThisVisit.has(entry.id)}
                now={now}
                actions={{
                  onDone: () => actions.markDone(entry.id),
                  onKeep: () => actions.keep(entry.id),
                  onRestore: () => actions.restore(entry.id),
                  onChat: () =>
                    host.askLangy({ draft: `Follow up on the insight "${entry.title}": ` }),
                  onNotUseful: () =>
                    host.askLangy({
                      draft: `The insight "${entry.title}" isn't useful because `,
                    }),
                }}
              />
            ))}
          </VStack>
        )}
      </Box>
    </HStack>
  );
}

function isUnseen(entry: InsightEntry): boolean {
  return entry.seenAt === null;
}

/** The list's final shape while it loads: the rail and three rows. */
function InboxSkeleton() {
  return (
    <HStack align="flex-start" gap={6} width="full" data-testid="insights-loading">
      <VStack align="stretch" gap={1.5} width="168px" flexShrink={0}>
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} height="26px" borderRadius="lg" />
        ))}
      </VStack>
      <VStack align="stretch" gap={3} flex={1}>
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} height="120px" />
        ))}
      </VStack>
    </HStack>
  );
}
