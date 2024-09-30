import {
  Box,
  Button,
  HStack,
  Link,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";

import { modelProviderIcons } from "../../server/modelProviders/iconsMap";
import { titleCase } from "../../utils/stringCasing";
import {
  Alert,
  AlertIcon,
  AlertTitle,
  AlertDescription,
} from "@chakra-ui/react";

export const AddModelProviderKey = ({
  nodeProvidersWithoutCustomKeys,
}: {
  nodeProvidersWithoutCustomKeys: string[];
}) => {
  return (
    <Alert status="warning">
      <VStack align="start" width="full">
        <HStack paddingBottom={3}>
          <AlertIcon />
          <Text>Add keys to run evaluations</Text>
        </HStack>
        <VStack align="start" width="full" spacing={3}>
          {nodeProvidersWithoutCustomKeys.map((provider) => (
            <HStack key={provider} width="full">
              <Box height={6} width={6}>
                {
                  modelProviderIcons[
                    provider as keyof typeof modelProviderIcons
                  ]
                }
              </Box>
              <Text>{titleCase(provider)}</Text>
              <Spacer />

              <Link href="/settings/model-providers" target="_blank">
                <Button size="sm">Add keys</Button>
              </Link>
            </HStack>
          ))}
        </VStack>
      </VStack>
    </Alert>
  );
};
