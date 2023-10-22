import {
  Card,
  CardBody,
  CardHeader,
  Container,
  Grid,
  GridItem,
  Heading,
} from "@chakra-ui/react";
import { DashboardLayout } from "~/components/DashboardLayout";

export default function Index() {
  return (
    <DashboardLayout>
      <Container maxWidth="1200" padding={6}>
        <Grid width="100%" templateColumns="1fr 0.5fr" gap={6}>
          <GridItem>
            <Card>
              <CardHeader>
                <Heading size="sm">Business</Heading>
              </CardHeader>
              <CardBody>TODO</CardBody>
            </Card>
          </GridItem>
          <GridItem>
            <Card>
              <CardHeader>
                <Heading size="sm">Main Topics</Heading>
              </CardHeader>
              <CardBody>TODO</CardBody>
            </Card>
          </GridItem>
          <GridItem>
            <Card>
              <CardHeader>
                <Heading size="sm">Usage</Heading>
              </CardHeader>
              <CardBody>TODO</CardBody>
            </Card>
          </GridItem>
          <GridItem>
            <Card>
              <CardHeader>
                <Heading size="sm">Validation Summary</Heading>
              </CardHeader>
              <CardBody>TODO</CardBody>
            </Card>
          </GridItem>
        </Grid>
      </Container>
    </DashboardLayout>
  );
}
