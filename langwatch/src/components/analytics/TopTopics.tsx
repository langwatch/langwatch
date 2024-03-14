import {
  Box,
  Card,
  CardBody,
  Checkbox,
  HStack,
  Heading,
  Skeleton,
  Text,
  Tooltip,
  VStack,
} from "@chakra-ui/react";
import { useRouter } from "next/router";
import React, { useEffect, useState } from "react";
import { HelpCircle } from "react-feather";
import { useFilterParams } from "../../hooks/useFilterParams";
import { api } from "../../utils/api";
import { OverflownTextWithTooltip } from "../OverflownText";

export function TopTopics() {
  const router = useRouter();
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const { filterParams, queryOpts } = useFilterParams();

  useEffect(() => {
    if (router.query.topics) {
      setSelectedTopics((router.query.topics as string).split(","));
    }
  }, [router.query.topics]);

  const paramsWithoutTopics = {
    ...filterParams,
    filters: {
      ...filterParams.filters,
      "topics.topics": [],
      "topics.subtopics": [],
    },
  };

  const topicCountsQuery = api.traces.getTopicCounts.useQuery(
    paramsWithoutTopics,
    queryOpts
  );

  const handleTopicChange = (topic: string, isChecked: boolean) => {
    setSelectedTopics((prevTopics) => {
      const newTopics = isChecked
        ? [...prevTopics, topic]
        : prevTopics.filter((t) => t !== topic);
      const topicsQuery =
        newTopics.length > 0 ? newTopics.join(",") : undefined;
      void router.push(
        {
          query: {
            ...router.query,
            topics: topicsQuery,
          },
        },
        undefined,
        { shallow: true }
      );
      return newTopics;
    });
  };

  const topTopics = topicCountsQuery.data
    ? topicCountsQuery.data.topicCounts
        .sort((a, b) => (a.name > b.name ? 1 : -1))
        .sort((a, b) => (a.count > b.count ? -1 : 1))
        .slice(0, 6)
    : [];

  const topTopicCount = topTopics[0] ? topTopics[0].count : 1;

  return (
    <Card width="full" height="410px">
      <CardBody width="full" paddingTop={6}>
        <Heading size="sm">Top Topics</Heading>
        <VStack width="full" spacing={4} paddingTop={6} align="start">
          {topicCountsQuery.isLoading ? (
            <>
              <Skeleton width="full" height="20px" />
              <Skeleton width="full" height="20px" />
              <Skeleton width="full" height="20px" />
            </>
          ) : topicCountsQuery.data ? (
            topTopics.length > 0 ? (
              topTopics.map((topic) => (
                <React.Fragment key={topic.id}>
                  <HStack align="start" spacing={4} width="100%">
                    <Checkbox
                      spacing={3}
                      flexGrow={1}
                      paddingTop={1}
                      isChecked={selectedTopics.includes(topic.id)}
                      onChange={(e) =>
                        handleTopicChange(topic.id, e.target.checked)
                      }
                    />
                    <VStack
                      align="start"
                      width="full"
                      cursor="pointer"
                      onClick={() =>
                        handleTopicChange(
                          topic.id,
                          !selectedTopics.includes(topic.id)
                        )
                      }
                    >
                      <HStack width="full">
                        <OverflownTextWithTooltip flexGrow={1} noOfLines={1}>
                          {topic.name}
                        </OverflownTextWithTooltip>
                        <Text color="gray.500" fontSize={12}>
                          {topic.count}
                        </Text>
                      </HStack>
                      <Box
                        width={`${(topic.count / topTopicCount) * 100}%`}
                        height="3px"
                        backgroundColor="orange.400"
                      ></Box>
                    </VStack>
                  </HStack>
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
      </CardBody>
    </Card>
  );
}
