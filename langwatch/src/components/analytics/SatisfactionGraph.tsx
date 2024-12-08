import {
  Card,
  CardBody,
  HStack,
  Tab,
  TabIndicator,
  TabList,
  TabPanel,
  TabPanels,
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
    <Card width="full" height="400px">
      <CardBody padding={0}>
        <Tabs variant="unstyled">
          <TabList gap={0}>
            <Tab width="50%" fontSize={14} paddingX={2} paddingY={4}>
              <HStack flexWrap="nowrap">
                <Text noOfLines={1}>Input Sentiment</Text>
              </HStack>
            </Tab>
            <Tab width="50%" fontSize={14} paddingX={2} paddingY={4}>
              <HStack flexWrap="nowrap">
                <Text noOfLines={1}>Thumbs Up/Down</Text>
              </HStack>
            </Tab>
          </TabList>
          <TabIndicator
            height="4px"
            bg="orange.400"
            borderRadius="1px"
            minWidth="50%"
            maxWidth="50%"
          />
          <TabPanels>
            <TabPanel padding={isNotQuickwit ? 0 : undefined}>
              <CustomGraph input={inputSentimentGraph} hideGroupLabel={true} />
            </TabPanel>
            <TabPanel padding={isNotQuickwit ? 0 : undefined}>
              <CustomGraph input={thumbsUpDownGraph} hideGroupLabel={true} />
            </TabPanel>
          </TabPanels>
        </Tabs>
      </CardBody>
    </Card>
  );
};
