import { EmptyState, Heading, HStack, Skeleton, Text, VStack } from "@chakra-ui/react";
import { Checkbox } from "@langwatch/design-system/checkbox";
import React, { useEffect, useRef, useState } from "react";

import {
  analyticsApi,
  type AnalyticsSubtopicCount,
  type AnalyticsTopicCount,
} from "../../behavior/analytics-api.ts";
import { useFilterParams } from "../../behavior/use-filter-params.ts";
import { useAnalyticsHost } from "../../model/analytics-host.ts";
import {
  orderByCountThenName,
  readListParam,
  toggleSubtopic,
  toggleTopic,
  toListParam,
} from "../../model/topic-selection.ts";
import { Delayed } from "../elements/delayed.tsx";
import { OverflownTextWithTooltip } from "../elements/overflown-text.tsx";

type TopicCounts = {
  topicCounts: AnalyticsTopicCount[];
  subtopicCounts: AnalyticsSubtopicCount[];
};

export function TopicsSelector({ showTitle = true }: { showTitle?: boolean }) {
  const host = useAnalyticsHost();
  const { query } = host.route();
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [selectedSubtopics, setSelectedSubtopics] = useState<string[]>([]);
  const { filterParams, queryOpts } = useFilterParams();

  useEffect(() => {
    setSelectedTopics(readListParam(query.topics));
  }, [query.topics]);

  useEffect(() => {
    setSelectedSubtopics(readListParam(query.subtopics));
  }, [query.subtopics]);

  const topicCountsQuery = analyticsApi.traces.getTopicCounts.useQuery(
    {
      ...filterParams,
      filters: {
        ...filterParams.filters,
        "topics.topics": [],
        "topics.subtopics": [],
      },
    },
    {
      ...queryOpts,
      // Keeps the previous answer on screen while the next one loads. The
      // React Query sentinel would mean importing the query library, which a
      // governed screen may not; the identity function is what that sentinel
      // does.
      placeholderData: (previous?: TopicCounts) => previous,
    },
  );

  const handleTopicChange = (topicId: string, checked: boolean) => {
    const next = toggleTopic({
      selection: { topics: selectedTopics, subtopics: selectedSubtopics },
      topicId,
      checked,
      subtopicCounts: topicCountsQuery.data?.subtopicCounts,
    });
    setSelectedTopics(next.topics);
    setSelectedSubtopics(next.subtopics);
    host.setQuery({
      ...query,
      topics: toListParam(next.topics),
      subtopics: toListParam(next.subtopics),
    });
  };

  const handleSubtopicChange = (subtopicId: string, checked: boolean) => {
    const newSubtopics = toggleSubtopic({ subtopics: selectedSubtopics, subtopicId, checked });
    setSelectedSubtopics(newSubtopics);
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
        <Heading fontSize="sm" as="h2">
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
          <EmptyState.Root size="sm">
            <EmptyState.Content>
              <VStack textAlign="center">
                <EmptyState.Title textStyle="sm">No topics found</EmptyState.Title>
                <EmptyState.Description textStyle="xs">
                  Topics are assigned automatically after enough messages are collected.{" "}
                </EmptyState.Description>
              </VStack>
            </EmptyState.Content>
          </EmptyState.Root>
        )}
        {!isLoadingTopics && !topicData && (
          <EmptyState.Root size="sm">
            <EmptyState.Content>
              <EmptyState.Title textStyle="sm">No topics found</EmptyState.Title>
            </EmptyState.Content>
          </EmptyState.Root>
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
      <Text color="fg.muted" fontSize="12px" whiteSpace="nowrap">
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
      <Text color="fg.muted" fontSize="12px" whiteSpace="nowrap">
        {count}
      </Text>
    </HStack>
  );
}
