import {
  Box,
  Center,
  Container,
  SkeletonText,
  VStack,
  Text,
} from "@chakra-ui/react";
import { FullLogo } from "~/components/icons/FullLogo";

interface OnboardingContainerProps extends React.PropsWithChildren {
  loading?: boolean;
  title: string;
  subTitle?: string;
}

export const OrganizationOnboardingContainer: React.FC<
  OnboardingContainerProps
> = ({ children, loading, title, subTitle }) => {
  return (
    <Box w="dvw" h="dvh" pt={"12vh"} background="bg.subtle">
      <Center>
        <FullLogo width={175} />
      </Center>

      <Container mt={"10"} maxW={"700px"}>
        <VStack gap={4} align="stretch">
          <VStack gap={0} align="start">
            <Text textStyle={"2xl"} fontWeight={"bold"} color={"WindowText"}>
              {title}
            </Text>
            {subTitle && (
              <Text textStyle={"md"} color={"WindowText"}>
                {subTitle}
              </Text>
            )}
          </VStack>

          {loading && (
            <SkeletonText variant={"pulse"} noOfLines={2} loading={loading} />
          )}
          {!loading && children}
        </VStack>
      </Container>
    </Box>
  );
};
