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

export const AddModelProviderKey = ({
  nodeProvidersWithoutCustomKeys,
}: {
  nodeProvidersWithoutCustomKeys: string[];
}) => {
  return (
    <VStack align="start" width="full" spacing={5} padding={6}>
      {nodeProvidersWithoutCustomKeys.map((provider) => (
        <HStack key={provider} width="full">
          <Box height={6} width={6}>
            {modelProviderIcons[provider as keyof typeof modelProviderIcons]}
          </Box>
          <Text>{provider.toUpperCase()}</Text>
          <Spacer />
          <Text>No keys added</Text>
          <Link href="/settings/model-providers">
            <Button size="sm">Add keys</Button>
          </Link>
        </HStack>
      ))}
    </VStack>
  );
};
