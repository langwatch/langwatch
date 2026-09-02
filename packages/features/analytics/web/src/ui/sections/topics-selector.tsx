import { EmptyState, Heading, HStack, Skeleton, Text, VStack } from "@chakra-ui/react";
import React, { useEffect, useRef, useState } from "react";
import { useAnalyticsHost } from "../../model/analytics-host";
import { useFilterParams } from "../../behavior/use-filter-params";
import {
  analyticsApi,
  type AnalyticsSubtopicCount,
  type AnalyticsTopicCount,
} from "../../behavior/analytics-api";
import { Delayed } from "../elements/delayed";
import { OverflownTextWithTooltip } from "../elements/overflown-text";
import { Checkbox } from "@langwatch/design-system/checkbox";

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
    setSelectedTopics(query.topics ? query.topics.split(",") : []);
  }, [query.topics]);

  useEffect(() => {
    setSelectedSubtopics(query.subtopics ? query.subtopics.split(",") : []);
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
    const newTopics = checked
      ? [...selectedTopics, topicId]
      : selectedTopics.filter((t) => t !== topicId);

    let newSubtopics = selectedSubtopics;
    if (!checked) {
      const subtopics = topicCountsQuery.data?.subtopicCounts.filter(
        (subtopic) => subtopic.parentId === topicId,
      );
      if (subtopics) {
        newSubtopics = selectedSubtopics.filter((t) => !subtopics.map((s) => s.id).includes(t));
      }
    }

    setSelectedTopics(newTopics);
    setSelectedSubtopics(newSubtopics);

    const topicsQuery = newTopics.length > 0 ? newTopics.join(",") : undefined;
    const subtopicsQuery = newSubtopics.length > 0 ? newSubtopics.join(",") : undefined;
    host.setQuery({
      ...query,
      topics: topicsQuery,
      subtopics: subtopicsQuery,
    });
  };

  const handleSubtopicChange = (subtopicId: string, checked: boolean) => {
    const newSubtopics = checked
      ? [...selectedSubtopics, subtopicId]
      : selectedSubtopics.filter((t) => t !== subtopicId);
    const subtopicsQuery = newSubtopics.length > 0 ? newSubtopics.join(",") : undefined;
    setSelectedSubtopics(newSubtopics);

    host.setQuery({ ...query, subtopics: subtopicsQuery });
  };

  const topicSelectorRef = useRef<HTMLDivElement>(null);
  const [minHeight, setMinHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (topicSelectorRef.current && topicCountsQuery.data) {
      const currentHeight = topicSelectorRef.current.clientHeight;

      setMinHeight((minHeight) => (currentHeight > (minHeight ?? 0) ? currentHeight : minHeight));
    }
  }, [topicCountsQuery.data]);

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
        {topicCountsQuery.isLoading ? (
          <Delayed>
            <Skeleton width="full" height="20px" />
            <Skeleton width="full" height="20px" />
            <Skeleton width="full" height="20px" />
          </Delayed>
        ) : topicCountsQuery.data ? (
          topicCountsQuery.data.topicCounts.length > 0 ? (
            [...topicCountsQuery.data.topicCounts]
              .sort((a, b) => (a.name > b.name ? 1 : -1))
              .sort((a, b) => (a.count > b.count ? -1 : 1))
              .map((topic) => (
                <React.Fragment key={topic.id}>
                  <HStack
                    gap={1}
                    width="full"
                    paddingX={2}
                    cursor="pointer"
                    fontWeight={selectedTopics.includes(topic.id) ? "500" : "normal"}
                  >
                    <Checkbox
                      borderColor="border.emphasized"
                      gap={3}
                      flexGrow={1}
                      checked={selectedTopics.includes(topic.id)}
                      onChange={(e) => handleTopicChange(topic.id, e.target.checked)}
                      size="sm"
                    >
                      <OverflownTextWithTooltip
                        lineClamp={1}
                        wordBreak="break-all"
                        maxWidth="300px"
                      >
                        {topic.name}
                      </OverflownTextWithTooltip>
                    </Checkbox>
                    <Text color="fg.muted" fontSize="12px" whiteSpace="nowrap">
                      {topic.count}
                    </Text>
                  </HStack>
                  {selectedTopics.includes(topic.id) &&
                    [...topicCountsQuery.data.subtopicCounts]
                      .sort((a, b) => (a.name > b.name ? 1 : -1))
                      .sort((a, b) => (a.count > b.count ? -1 : 1))
                      .filter((subtopic) => subtopic.parentId === topic.id)
                      .map((subtopic) => (
                        <HStack
                          key={subtopic.id}
                          gap={1}
                          width="full"
                          paddingX={2}
                          paddingLeft={8}
                          cursor="pointer"
                          fontWeight="normal"
                        >
                          <Checkbox
                            borderColor="border.emphasized"
                            gap={3}
                            flexGrow={1}
                            checked={selectedSubtopics.includes(subtopic.id)}
                            onChange={(e) => handleSubtopicChange(subtopic.id, e.target.checked)}
                          >
                            <OverflownTextWithTooltip
                              lineClamp={1}
                              wordBreak="break-all"
                              maxWidth="300px"
                            >
                              {subtopic.name}
                            </OverflownTextWithTooltip>
                          </Checkbox>
                          <Text color="fg.muted" fontSize="12px" whiteSpace="nowrap">
                            {subtopic.count}
                          </Text>
                        </HStack>
                      ))}
                </React.Fragment>
              ))
          ) : (
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
          )
        ) : (
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
