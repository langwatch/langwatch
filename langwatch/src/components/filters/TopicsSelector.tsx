import {
  Checkbox,
  Divider,
  HStack,
  Heading,
  Skeleton,
  Text,
  Tooltip,
  VStack,
} from "@chakra-ui/react";
import { useRouter } from "next/router";
import React, { useEffect, useRef, useState } from "react";
import { HelpCircle } from "react-feather";
import { api } from "../../utils/api";
import { useFilterParams } from "../../hooks/useFilterParams";
import { OverflownTextWithTooltip } from "../OverflownText";

export function TopicsSelector() {
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

  const handleTopicChange = (topicId: string, isChecked: boolean) => {
    const newTopics = isChecked
      ? [...selectedTopics, topicId]
      : selectedTopics.filter((t) => t !== topicId);

    let newSubtopics = selectedSubtopics;
    if (!isChecked) {
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

  const handleSubtopicChange = (subtopicId: string, isChecked: boolean) => {
    const newSubtopics = isChecked
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
      spacing={6}
      ref={topicSelectorRef}
      minHeight={`${minHeight}px`}
    >
      <Heading as="h2" size="md">
        Topics
      </Heading>
      <VStack width="full" spacing={4} align="start">
        {topicCountsQuery.isLoading ? (
          <>
            <Skeleton width="full" height="20px" />
            <Skeleton width="full" height="20px" />
            <Skeleton width="full" height="20px" />
          </>
        ) : topicCountsQuery.data ? (
          topicCountsQuery.data.topicCounts.length > 0 ? (
            topicCountsQuery.data.topicCounts
              .sort((a, b) => (a.name > b.name ? 1 : -1))
              .sort((a, b) => (a.count > b.count ? -1 : 1))
              .map((topic) => (
                <React.Fragment key={topic.id}>
                  <HStack
                    spacing={1}
                    width="full"
                    paddingX={2}
                    fontWeight={
                      selectedTopics.includes(topic.id) ? "500" : "normal"
                    }
                  >
                    <Checkbox
                      borderColor="gray.400"
                      spacing={3}
                      flexGrow={1}
                      isChecked={selectedTopics.includes(topic.id)}
                      onChange={(e) =>
                        handleTopicChange(topic.id, e.target.checked)
                      }
                    >
                      <OverflownTextWithTooltip
                        noOfLines={1}
                        wordBreak="break-all"
                        fontSize={15}
                      >
                        {topic.name}
                      </OverflownTextWithTooltip>
                    </Checkbox>
                    <Text color="gray.500" fontSize={12} whiteSpace="nowrap">
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
                          spacing={1}
                          width="full"
                          paddingX={2}
                          paddingLeft={8}
                          fontWeight="normal"
                          fontSize={15}
                        >
                          <Checkbox
                            borderColor="gray.400"
                            spacing={3}
                            flexGrow={1}
                            isChecked={selectedSubtopics.includes(subtopic.id)}
                            onChange={(e) =>
                              handleSubtopicChange(
                                subtopic.id,
                                e.target.checked
                              )
                            }
                          >
                            <OverflownTextWithTooltip
                              noOfLines={1}
                              wordBreak="break-all"
                            >
                              {subtopic.name}
                            </OverflownTextWithTooltip>
                          </Checkbox>
                          <Text
                            color="gray.500"
                            fontSize={12}
                            whiteSpace="nowrap"
                          >
                            {subtopic.count}
                          </Text>
                        </HStack>
                      ))}
                  <Divider borderColor="gray.350" _last={{ display: "none" }} />
                </React.Fragment>
              ))
          ) : (
            <HStack>
              <Text>No topics found</Text>
              <Tooltip label="Topics are assigned automatically to a group of messages. If you already have enough messages, it may take a day topics to be generated">
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
