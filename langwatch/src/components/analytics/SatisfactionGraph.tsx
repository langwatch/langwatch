import {
  Card,
  HStack,
  Tabs,
  Text,
} from "@chakra-ui/react";
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
        name: "Messages",
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
        name: "Messages",
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
    <Card.Root width="full" height="400px">
      <Card.Body padding={0}>
        <Tabs.Root variant="plain">
          <Tabs.List gap={0}>
            <Tabs.Trigger value="input-sentiment" width="50%" fontSize={14} paddingX={2} paddingY={4}>
              <HStack flexWrap="nowrap">
                <Text lineClamp={1}>Input Sentiment</Text>
              </HStack>
            </Tabs.Trigger>
            <Tabs.Trigger value="thumbs" width="50%" fontSize={14} paddingX={2} paddingY={4}>
              <HStack flexWrap="nowrap">
                <Text lineClamp={1}>Thumbs Up/Down</Text>
              </HStack>
            </Tabs.Trigger>
            <Tabs.Indicator
              height="4px"
              bg="orange.400"
              borderRadius="1px"
              minWidth="50%"
              maxWidth="50%"
            />
          </Tabs.List>
          <Tabs.Content value="input-sentiment" padding={isNotQuickwit ? 0 : undefined}>
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
