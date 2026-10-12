import { Checkbox } from "@langwatch/design-system/checkbox";
import { Delayed } from "@langwatch/design-system/delayed";
import { NoDataInfoBlock, type EmptyNext } from "@langwatch/design-system/no-data-info-block";
import { OverflownTextWithTooltip } from "@langwatch/design-system/overflown-text";
import { Heading, HStack, Skeleton, Text, VStack } from "@langwatch/design-system/primitives";
import { Tags } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";

import { useTopicCounts } from "../../behavior/use-filter-options.ts";
import { useAnalyticsHost } from "../../model/analytics-host.ts";
import {
  orderByCountThenName,
  readListParam,
  toggleSubtopic,
  toggleTopic,
  toListParam,
} from "../../model/topic-selection.ts";
import { ChartErrorState } from "../elements/chart-error-state.tsx";

const TOPICS_NEXT: EmptyNext = [
  {
    kind: "docs",
    label: "How topics are grouped",
    href: "https://docs.langwatch.ai/features/topic-clustering",
  },
];

export function TopicsSelector({ showTitle = true }: { showTitle?: boolean }) {
  const host = useAnalyticsHost();
  const { query } = host.route();
  const selectedTopics = readListParam(query.topics);
  const selectedSubtopics = readListParam(query.subtopics);
  const topicCountsQuery = useTopicCounts();

  const handleTopicChange = (topicId: string, checked: boolean) => {
    const next = toggleTopic({
      selection: { topics: selectedTopics, subtopics: selectedSubtopics },
      topicId,
      checked,
      subtopicCounts: topicCountsQuery.data?.subtopicCounts,
    });
    host.setQuery({
      ...query,
      topics: toListParam(next.topics),
      subtopics: toListParam(next.subtopics),
    });
  };

  const handleSubtopicChange = (subtopicId: string, checked: boolean) => {
    const newSubtopics = toggleSubtopic({ subtopics: selectedSubtopics, subtopicId, checked });
    host.setQuery({ ...query, subtopics: toListParam(newSubtopics) });
  };

  const topicSelectorRef = useRef<HTMLDivElement>(null);
  const [minHeight, setMinHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (topicSelectorRef.current && topicCountsQuery.data) {
      const currentHeight = topicSelectorRef.current.clientHeight;

      setMinHeight((minHeight) => (currentHeight > (minHeight ?? 0) ? currentHeight : minHeight));
    }
  }, [topicCountsQuery.data]);

  const topicData = topicCountsQuery.data;
  const topicCounts = topicData?.topicCounts ?? [];
  const subtopicCounts = topicData?.subtopicCounts ?? [];
  const isLoadingTopics = topicCountsQuery.isLoading;

  return (
    <VStack
      align="start"
      width="full"
      gap={4}
      ref={topicSelectorRef}
      minHeight={minHeight ? `${minHeight}px` : undefined}
    >
      {showTitle && (
        <Heading size="sm" fontSize="sm" as="h2">
          Topics
        </Heading>
      )}
      <VStack width="full" gap={4} align="start">
        {isLoadingTopics && (
          <Delayed>
            <Skeleton width="full" height="20px" />
            <Skeleton width="full" height="20px" />
            <Skeleton width="full" height="20px" />
          </Delayed>
        )}
        {topicCountsQuery.error && !topicData && (
          <ChartErrorState
            error={topicCountsQuery.error}
            onRetry={() => void topicCountsQuery.refetch()}
            fallbackTitle="Couldn't load topics"
          />
        )}
        {!isLoadingTopics && topicData && topicCounts.length > 0 && (
          <>
            {orderByCountThenName(topicCounts).map((topic) => (
              <React.Fragment key={topic.id}>
                <TopicRow
                  name={topic.name}
                  count={topic.count}
                  checked={selectedTopics.includes(topic.id)}
                  onToggle={(checked) => handleTopicChange(topic.id, checked)}
                />
                {selectedTopics.includes(topic.id) &&
                  orderByCountThenName(subtopicCounts)
                    .filter((subtopic) => subtopic.parentId === topic.id)
                    .map((subtopic) => (
                      <SubtopicRow
                        key={subtopic.id}
                        name={subtopic.name}
                        count={subtopic.count}
                        checked={selectedSubtopics.includes(subtopic.id)}
                        onToggle={(checked) => handleSubtopicChange(subtopic.id, checked)}
                      />
                    ))}
              </React.Fragment>
            ))}
          </>
        )}
        {!isLoadingTopics && topicData && topicCounts.length === 0 && (
          <NoDataInfoBlock
            size="inline"
            bordered={false}
            icon={<Tags size={20} />}
            title="No topics found"
            description="Topics are assigned automatically after enough messages are collected."
            next={TOPICS_NEXT}
          />
        )}
        {!isLoadingTopics && !topicData && (
          <NoDataInfoBlock
            size="inline"
            bordered={false}
            icon={<Tags size={20} />}
            title="No topics found"
            description="Topics appear here once messages have been grouped."
            next={TOPICS_NEXT}
          />
        )}
      </VStack>
    </VStack>
  );
}

type TopicRowProps = {
  name: string;
  count: number;
  checked: boolean;
  onToggle: (checked: boolean) => void;
};

function TopicRow({ name, count, checked, onToggle }: TopicRowProps) {
  return (
    <HStack
      gap={1}
      width="full"
      paddingX={2}
      cursor="pointer"
      fontWeight={checked ? "500" : "normal"}
    >
      <Checkbox
        borderColor="border.emphasized"
        gap={3}
        flexGrow={1}
        checked={checked}
        onChange={(e) => onToggle(e.target.checked)}
        size="sm"
      >
        <OverflownTextWithTooltip lineClamp={1} wordBreak="break-all" maxWidth="300px">
          {name}
        </OverflownTextWithTooltip>
      </Checkbox>
      <Text color="fg.muted" textStyle="caption" whiteSpace="nowrap">
        {count}
      </Text>
    </HStack>
  );
}

function SubtopicRow({ name, count, checked, onToggle }: TopicRowProps) {
  return (
    <HStack gap={1} width="full" paddingX={2} paddingLeft={8} cursor="pointer" fontWeight="normal">
      <Checkbox
        borderColor="border.emphasized"
        gap={3}
        flexGrow={1}
        checked={checked}
        onChange={(e) => onToggle(e.target.checked)}
      >
        <OverflownTextWithTooltip lineClamp={1} wordBreak="break-all" maxWidth="300px">
          {name}
        </OverflownTextWithTooltip>
      </Checkbox>
      <Text color="fg.muted" textStyle="caption" whiteSpace="nowrap">
        {count}
      </Text>
    </HStack>
  );
}
