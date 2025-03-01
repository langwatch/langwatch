import {
  Alert,
  Box,
  Button,
  HStack,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";

import { modelProviderIcons } from "../../server/modelProviders/iconsMap";
import { titleCase } from "../../utils/stringCasing";
import { Link } from "../../components/ui/link";

export const AddModelProviderKey = ({
  runWhat,
  nodeProvidersWithoutCustomKeys,
}: {
  runWhat: string;
  nodeProvidersWithoutCustomKeys: string[];
}) => {
  return (
    <Alert.Root status="warning">
      <Alert.Content>
        <VStack align="start" width="full">
          <HStack paddingBottom={3}>
            <Text>
              You need to set up your own API keys for the following providers
              to be able to {runWhat}:
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
                <Text color="gray.800">{titleCase(provider)}</Text>
                <Spacer />

                <Link href="/settings/model-providers" isExternal>
                  <Button colorPalette="orange" size="sm">
                    Add keys
                  </Button>
                </Link>
              </HStack>
            ))}
          </VStack>
        </VStack>
      </Alert.Content>
    </Alert.Root>
  );
};
