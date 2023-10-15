import { Box, Card, CardBody, Container } from "@chakra-ui/react";
import { type PropsWithChildren } from "react";

export const SetupLayout = ({ children }: PropsWithChildren) => {
  return (
    <Box
      width="full"
      height="full"
      minHeight="100vh"
      backgroundColor="gray.300"
      paddingTop={16}
    >
      <Container>
        <Card>
          <CardBody>{children}</CardBody>
        </Card>
      </Container>
    </Box>
  );
};
