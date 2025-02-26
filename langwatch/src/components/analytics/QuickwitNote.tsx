import { Alert, HStack, Text } from "@chakra-ui/react";
import { Info } from "react-feather";
import { Tooltip } from "../ui/tooltip";

export function QuickwitNote() {
  return (
    <Alert.Root status="warning">
      <Alert.Content>
        <HStack gap={2}>
          <Text>Graph not supported in lite installation</Text>
          <Tooltip content="Use the docker version of LangWatch with OpenSearch to enable this graph, or switch to LangWatch Cloud or Enterprise.">
            <Info size={16} />
          </Tooltip>
        </HStack>
      </Alert.Content>
    </Alert.Root>
  );
}
