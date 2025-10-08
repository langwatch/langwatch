import { Box, Center, Container, SkeletonText } from "@chakra-ui/react";
import { FullLogo } from "~/components/icons/FullLogo";

interface OnboardingContainerProps extends React.PropsWithChildren {
  loading?: boolean;
}

export const OrganizationOnboardingContainer: React.FC<OnboardingContainerProps> = ({ children, loading }) => {
  return (
    <Box w="dvw" h="dvh" pt={"10"} background="bg.subtle">
      <Center>
        <FullLogo width={175} />
      </Center>

      <Container mt={"10"} maxW={"700px"}>
        {loading && (
          <SkeletonText variant={"pulse"} noOfLines={2} loading={loading} />
        )}
        {!loading && children}
      </Container>
    </Box>
  );
}
