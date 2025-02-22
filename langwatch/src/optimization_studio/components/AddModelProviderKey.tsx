import {
  Box,
  Button,
  HStack,
  Link,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";

import { Alert } from "@chakra-ui/react";
import { modelProviderIcons } from "../../server/modelProviders/iconsMap";
import { titleCase } from "../../utils/stringCasing";

export const AddModelProviderKey = ({
  runWhat,
  nodeProvidersWithoutCustomKeys,
}: {
  runWhat: string;
  nodeProvidersWithoutCustomKeys: string[];
}) => {
  return (
    <Alert status="warning">
      <VStack align="start" width="full">
        <HStack paddingBottom={3}>
          <Text>
            You need to set up your own API keys for the following providers to
            be able to {runWhat}:
          </Text>
        </HStack>
        <VStack align="start" width="full" gap={3}>
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
                <Button colorPalette="orange" size="sm">
                  Add keys
                </Button>
              </Link>
            </HStack>
          ))}
        </VStack>
      </VStack>
    </Alert>
  );
};
