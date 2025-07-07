import { Card, HStack, Tabs, Text } from "@chakra-ui/react";
import { CustomGraph, type CustomGraphInput } from "./CustomGraph";
import { usePublicEnv } from "../../hooks/usePublicEnv";

export const SatisfactionGraphs = () => {
  const publicEnv = usePublicEnv();
  const isNotQuickwit = publicEnv.data && !publicEnv.data.IS_QUICKWIT;

  const inputSentimentGraph: CustomGraphInput = {
    graphId: "inputSentimentCountGraph",
    graphType: "donnut",
    series: [
      {
        name: "Traces",
        metric: "metadata.trace_id",
        aggregation: "cardinality",
        colorSet: "positiveNegativeNeutral",
      },
    ],
    groupBy: "sentiment.input_sentiment",
    includePrevious: false,
    timeScale: "full",
    height: 280,
  };

  const thumbsUpDownGraph: CustomGraphInput = {
    graphId: "thumbsUpDownCountGraph",
    graphType: "stacked_bar",
    series: [
      {
        name: "Traces",
        metric: "metadata.trace_id",
        aggregation: "cardinality",
        colorSet: "positiveNegativeNeutral",
      },
    ],
    groupBy: "sentiment.thumbs_up_down",
    includePrevious: false,
    timeScale: 7,
    height: 280,
  };

  return (
    <Card.Root width="full" height="360px">
      <Card.Body padding={0}>
        <Tabs.Root variant="plain" defaultValue="input-sentiment">
          <Tabs.List gap={0} width="100%">
            <Tabs.Trigger
              value="input-sentiment"
              width="50%"
              fontSize="14px"
              paddingX={2}
            >
              <HStack
                width="100%"
                paddingY={2}
                flexWrap="nowrap"
                justifyContent="center"
              >
                <Text lineClamp={1}>Input Sentiment</Text>
              </HStack>
            </Tabs.Trigger>
            <Tabs.Trigger
              value="thumbs"
              width="50%"
              fontSize="14px"
              paddingX={2}
            >
              <HStack
                width="100%"
                paddingY={2}
                flexWrap="nowrap"
                justifyContent="center"
              >
                <Text lineClamp={1}>Thumbs Up/Down</Text>
              </HStack>
            </Tabs.Trigger>
            <Tabs.Indicator
              height="4px"
              bg="orange.400"
              borderRadius="1px"
              minWidth="50%"
              maxWidth="50%"
              bottom={0}
            />
          </Tabs.List>
          <Tabs.Content
            value="input-sentiment"
            padding={isNotQuickwit ? 0 : undefined}
          >
            <CustomGraph input={inputSentimentGraph} hideGroupLabel={true} />
          </Tabs.Content>
          <Tabs.Content value="thumbs" padding={isNotQuickwit ? 0 : undefined}>
            <CustomGraph input={thumbsUpDownGraph} hideGroupLabel={true} />
          </Tabs.Content>
        </Tabs.Root>
      </Card.Body>
    </Card.Root>
  );
};
