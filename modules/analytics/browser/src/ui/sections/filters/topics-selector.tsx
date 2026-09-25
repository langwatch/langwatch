import { EmptyState, Heading, HStack, Skeleton, Text, VStack } from "@chakra-ui/react";
import { useFilterParams } from "@langwatch/analytics-browser-kit";
import { useRouter } from "@langwatch/browser-host/use-router";
import { api } from "@langwatch/browser-trpc/workflow-api";
import { Checkbox } from "@langwatch/design-system/checkbox";
import { Delayed } from "@langwatch/design-system/delayed";
import { OverflownTextWithTooltip } from "@langwatch/design-system/overflown-text";
import { keepPreviousData } from "@tanstack/react-query";
import React, { useEffect, useRef, useState } from "react";

import type {
  AnalyticsSubtopicCount,
  AnalyticsTopicCount,
} from "../../../behavior/analytics-api.ts";
import {
  orderByCountThenName,
  readListParam,
  toggleSubtopic,
  toggleTopic,
  toListParam,
} from "../../../model/topic-selection.ts";

export function TopicsSelector({ showTitle = true }: { showTitle?: boolean }) {
  const router = useRouter();
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [selectedSubtopics, setSelectedSubtopics] = useState<string[]>([]);
  const { filterParams, queryOpts } = useFilterParams();

  useEffect(() => {
    setSelectedTopics(readListParam(router.query.topics));
  }, [router.query.topics]);

  useEffect(() => {
    setSelectedSubtopics(readListParam(router.query.subtopics));
  }, [router.query.subtopics]);

  const topicCountsQuery = api.traces.getTopicCounts.useQuery(
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
      placeholderData: keepPreviousData,
    },
  );

  const pushQuery = (query: Record<string, string | undefined>) =>
    void router.push({ query: { ...router.query, ...query } }, undefined, { shallow: true });

  const handleTopicChange = (topicId: string, checked: boolean) => {
    const next = toggleTopic({
      selection: { topics: selectedTopics, subtopics: selectedSubtopics },
      topicId,
      checked,
      subtopicCounts: topicCountsQuery.data?.subtopicCounts,
    });
    setSelectedTopics(next.topics);
    setSelectedSubtopics(next.subtopics);
    pushQuery({ topics: toListParam(next.topics), subtopics: toListParam(next.subtopics) });
  };

  const handleSubtopicChange = (subtopicId: string, checked: boolean) => {
    const newSubtopics = toggleSubtopic({ subtopics: selectedSubtopics, subtopicId, checked });
    setSelectedSubtopics(newSubtopics);
    pushQuery({ subtopics: toListParam(newSubtopics) });
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
  const topicCounts: AnalyticsTopicCount[] = topicData?.topicCounts ?? [];
  const subtopicCounts: AnalyticsSubtopicCount[] = topicData?.subtopicCounts ?? [];
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
