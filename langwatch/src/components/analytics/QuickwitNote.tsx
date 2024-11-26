import { Alert, Tooltip, Text, HStack } from "@chakra-ui/react";
import { Info } from "react-feather";

export function QuickwitNote() {
  return (
    <Alert status="warning">
      <HStack>
        <Text>Graph not supported in lite installation</Text>
        <Tooltip label="Use the docker version of LangWatch with OpenSearch to enable this graph, or switch to LangWatch Cloud or Enterprise.">
          <Info size={16} />
        </Tooltip>
      </HStack>
    </Alert>
  );
}
