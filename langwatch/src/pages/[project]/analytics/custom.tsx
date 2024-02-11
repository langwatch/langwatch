import {
  Card,
  CardBody,
  Container,
  FormControl,
  HStack,
  Heading,
  VStack,
  Text,
  FormLabel,
} from "@chakra-ui/react";
import { DashboardLayout } from "../../../components/DashboardLayout";
import { Select as MultiSelect, chakraComponents } from "chakra-react-select";
import { TrendingUp, BarChart2 } from "react-feather";



export default function AnalyticsCustomGraph() {
  const chartOptions = [
    {
      label: "Line Chart",
      value: "line",
      icon: <TrendingUp />,
    },
    {
      label: "Bar Chart",
      value: "bar",
      icon: <BarChart2 />,
    },
  ];

  return (
    <DashboardLayout>
      <Container maxWidth="1600" padding={6}>
        <VStack width="full" align="start" spacing={6}>
          <Heading size="lg" paddingTop={1}>
            Custom Graph
          </Heading>
          <Card width="full">
            <CardBody>
              <HStack>
                <FormControl>
                  <FormLabel>Chart Type</FormLabel>
                  <MultiSelect
                    options={chartOptions}
                    placeholder="Select Chart Type"
                    isSearchable={false}
                    components={{
                      Option: ({ children, ...props }) => (
                        <chakraComponents.Option {...props}>
                          <HStack spacing={2}>
                            {props.data.icon}
                            <Text>{children}</Text>
                          </HStack>
                        </chakraComponents.Option>
                      ),
                      ValueContainer: ({ children, ...props }) => {
                        const { getValue } = props;
                        const value = getValue();
                        const icon = value.length > 0 ? value[0]?.icon : null;

                        return (
                          <chakraComponents.ValueContainer {...props}>
                            <HStack spacing={2}>
                              {icon}
                              {children}
                            </HStack>
                          </chakraComponents.ValueContainer>
                        );
                      },
                    }}
                  />
                </FormControl>
              </HStack>
            </CardBody>
          </Card>
        </VStack>
      </Container>
    </DashboardLayout>
  );
}
