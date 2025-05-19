import {
  Separator,
  HStack,
  Heading,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useRouter } from "next/router";
import React, { useEffect, useRef, useState } from "react";
import { HelpCircle } from "react-feather";
import { api } from "../../utils/api";
import { useFilterParams } from "../../hooks/useFilterParams";
import { OverflownTextWithTooltip } from "../OverflownText";
import { Delayed } from "../Delayed";
import { Tooltip } from "../ui/tooltip";
import { Checkbox } from "../ui/checkbox";

export function TopicsSelector({ showTitle = true }: { showTitle?: boolean }) {
  const router = useRouter();
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [selectedSubtopics, setSelectedSubtopics] = useState<string[]>([]);
  const { filterParams, queryOpts } = useFilterParams();

  useEffect(() => {
    if (router.query.topics) {
      setSelectedTopics((router.query.topics as string).split(","));
    } else {
      setSelectedTopics([]);
    }
  }, [router.query.topics]);

  useEffect(() => {
    if (router.query.subtopics) {
      setSelectedSubtopics((router.query.subtopics as string).split(","));
    } else {
      setSelectedSubtopics([]);
    }
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
      keepPreviousData: true,
    }
  );

  const handleTopicChange = (topicId: string, checked: boolean) => {
    const newTopics = checked
      ? [...selectedTopics, topicId]
      : selectedTopics.filter((t) => t !== topicId);

    let newSubtopics = selectedSubtopics;
    if (!checked) {
      const subtopics = topicCountsQuery.data?.subtopicCounts.filter(
        (subtopic) => subtopic.parentId === topicId
      );
      if (subtopics) {
        newSubtopics = selectedSubtopics.filter(
          (t) => !subtopics.map((s) => s.id).includes(t)
        );
      }
    }

    setSelectedTopics(newTopics);
    setSelectedSubtopics(newSubtopics);

    const topicsQuery = newTopics.length > 0 ? newTopics.join(",") : undefined;
    const subtopicsQuery =
      newSubtopics.length > 0 ? newSubtopics.join(",") : undefined;
    void router.push(
      {
        query: {
          ...router.query,
          topics: topicsQuery,
          subtopics: subtopicsQuery,
        },
      },
      undefined,
      { shallow: true }
    );
  };

  const handleSubtopicChange = (subtopicId: string, checked: boolean) => {
    const newSubtopics = checked
      ? [...selectedSubtopics, subtopicId]
      : selectedSubtopics.filter((t) => t !== subtopicId);
    const subtopicsQuery =
      newSubtopics.length > 0 ? newSubtopics.join(",") : undefined;
    setTimeout(() => {
      void router.push(
        {
          query: {
            ...router.query,
            subtopics: subtopicsQuery,
          },
        },
        undefined,
        { shallow: true }
      );
    }, 0);

    setSelectedSubtopics(newSubtopics);
  };

  const topicSelectorRef = useRef<HTMLDivElement>(null);
  const [minHeight, setMinHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (topicSelectorRef.current && topicCountsQuery.data) {
      const currentHeight = topicSelectorRef.current.clientHeight;

      setMinHeight((minHeight) =>
        currentHeight > (minHeight ?? 0) ? currentHeight : minHeight
      );
    }
  }, [topicCountsQuery.data]);

  return (
    <VStack
      align="start"
      width="full"
      gap={6}
      ref={topicSelectorRef}
      minHeight={`${minHeight}px`}
    >
      {showTitle && (
        <Heading as="h2" size="md">
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
            topicCountsQuery.data.topicCounts
              .sort((a, b) => (a.name > b.name ? 1 : -1))
              .sort((a, b) => (a.count > b.count ? -1 : 1))
              .map((topic) => (
                <React.Fragment key={topic.id}>
                  <HStack
                    gap={1}
                    width="full"
                    paddingX={2}
                    fontWeight={
                      selectedTopics.includes(topic.id) ? "500" : "normal"
                    }
                  >
                    <Checkbox
                      borderColor="gray.400"
                      gap={3}
                      flexGrow={1}
                      checked={selectedTopics.includes(topic.id)}
                      onChange={(e) =>
                        handleTopicChange(topic.id, e.target.checked)
                      }
                    >
                      <OverflownTextWithTooltip
                        lineClamp={1}
                        wordBreak="break-all"
                        fontSize="15px"
                        maxWidth="300px"
                      >
                        {topic.name}
                      </OverflownTextWithTooltip>
                    </Checkbox>
                    <Text color="gray.500" fontSize="12px" whiteSpace="nowrap">
                      {topic.count}
                    </Text>
                  </HStack>
                  {selectedTopics.includes(topic.id) &&
                    topicCountsQuery.data.subtopicCounts
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
                          fontWeight="normal"
                          fontSize="15px"
                        >
                          <Checkbox
                            borderColor="gray.400"
                            gap={3}
                            flexGrow={1}
                            checked={selectedSubtopics.includes(subtopic.id)}
                            onChange={(e) =>
                              handleSubtopicChange(
                                subtopic.id,
                                e.target.checked
                              )
                            }
                          >
                            <OverflownTextWithTooltip
                              lineClamp={1}
                              wordBreak="break-all"
                              maxWidth="300px"
                            >
                              {subtopic.name}
                            </OverflownTextWithTooltip>
                          </Checkbox>
                          <Text
                            color="gray.500"
                            fontSize="12px"
                            whiteSpace="nowrap"
                          >
                            {subtopic.count}
                          </Text>
                        </HStack>
                      ))}
                  <Separator
                    borderColor="gray.200"
                    _last={{ display: "none" }}
                  />
                </React.Fragment>
              ))
          ) : (
            <HStack>
              <Text>No topics found</Text>
              <Tooltip content="Topics are assigned automatically to a group of messages. If you already have enough messages, it may take a day topics to be generated">
                <HelpCircle width="14px" />
              </Tooltip>
            </HStack>
          )
        ) : (
          <Text>No topics found</Text>
        )}
      </VStack>
    </VStack>
  );
}
