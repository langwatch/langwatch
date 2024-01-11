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
import { useAnalyticsParams } from "../../hooks/useAnalyticsParams";
import { api } from "../../utils/api";

export function TopTopics() {
  const { analyticsParams, queryOpts } = useAnalyticsParams();
  const router = useRouter();
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);

  useEffect(() => {
    if (router.query.topics) {
      setSelectedTopics((router.query.topics as string).split(","));
    }
  }, [router.query.topics]);

  const paramsWithoutTopics = { ...analyticsParams, topics: undefined };

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
    ? Object.entries(topicCountsQuery.data)
        .sort((a, b) => (a[1] > b[1] ? -1 : 1))
        .slice(0, 6)
    : [];

  const topTopicCount = topTopics[0] ? topTopics[0][1] : 1;

  return (
    <Card width="full" height="382px">
      <CardBody width="full" paddingTop={6}>
        <Heading as="h2" size="md">
          Top Topics
        </Heading>
        <VStack width="full" spacing={4} paddingTop={6} align="start">
          {topicCountsQuery.isLoading ? (
            <>
              <Skeleton width="full" height="20px" />
              <Skeleton width="full" height="20px" />
              <Skeleton width="full" height="20px" />
            </>
          ) : topicCountsQuery.data ? (
            topTopics.length > 0 ? (
              topTopics.map(([topic, count]) => (
                <React.Fragment key={topic}>
                  <HStack align="start" spacing={4} width="100%">
                    <Checkbox
                      spacing={3}
                      flexGrow={1}
                      paddingTop={1}
                      isChecked={selectedTopics.includes(topic)}
                      onChange={(e) =>
                        handleTopicChange(topic, e.target.checked)
                      }
                    />
                    <VStack
                      align="start"
                      width="full"
                      cursor="pointer"
                      onClick={() =>
                        handleTopicChange(
                          topic,
                          !selectedTopics.includes(topic)
                        )
                      }
                    >
                      <HStack width="full">
                        <Text flexGrow={1} noOfLines={1}>
                          {topic}
                        </Text>
                        <Text color="gray.500" fontSize={12}>
                          {count}
                        </Text>
                      </HStack>
                      <Box
                        width={`${(count / topTopicCount) * 100}%`}
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
