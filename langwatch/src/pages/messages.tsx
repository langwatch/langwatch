import {
  Box,
  Card,
  CardBody,
  Checkbox,
  HStack,
  Input,
  Spacer,
  Tag,
  VStack,
} from "@chakra-ui/react";
import { type GetServerSideProps, type GetServerSidePropsContext } from "next";
import { type Session } from "next-auth";
import { Check, Filter, Search } from "react-feather";
import { type FullyLoadedOrganization } from "~/server/api/routers/organization";
import { withSignedInUserAndData } from "~/server/props";
import { DashboardLayout } from "../components/DashboardLayout";

type Props = {
  user: Session["user"];
  organizations: FullyLoadedOrganization[];
};

export default function Dashboard({ user, organizations }: Props) {
  const Message = () => {
    return (
      <Card>
        <CardBody>
          <VStack alignItems="flex-start" padding={6} spacing={4}>
            <HStack spacing={12} width="full">
              <Box fontSize={24} fontWeight="bold">
                What is up
              </Box>
              <Spacer />
              <Box>1273 tokens</Box>
              <Box>10s ago</Box>
            </HStack>
            <p>
              Hey there, I’m an AI assistant lorem ipsum dolor sit amet,
              consectetur adipiscing elit, sed do eiusmod tempor incididunt ut
              labore et dolore magna aliqua. Ut enim ad minim veniam, quis
              nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo
              consequat...
            </p>
            <HStack marginTop={1}>
              <Check size={16} />
              <Box>No PII leak</Box>
            </HStack>
            <HStack>
              <Tag size="md">Greeting</Tag>
              <Tag>Small Talk</Tag>
            </HStack>
          </VStack>
        </CardBody>
      </Card>
    );
  };

  return (
    <DashboardLayout user={user} organizations={organizations}>
      <VStack
        width="full"
        spacing={0}
        position="sticky"
        top={0}
        background="white"
      >
        <Box position="relative" width="full">
          <Box position="absolute" top={6} left={6}>
            <Search size={16} />
          </Box>
          <Input
            variant="unstyled"
            placeholder={"Search"}
            padding={5}
            paddingLeft={12}
            borderRadius={0}
            borderBottom="1px solid #E5E5E5"
          />
        </Box>
        <HStack
          paddingY={5}
          paddingX={6}
          spacing={12}
          width="full"
          borderBottom="1px solid #E5E5E5"
        >
          <Filter size={24} />
          <Spacer />
          <Checkbox>Inbox Narrator</Checkbox>
          <Checkbox>All models</Checkbox>
          <Checkbox>Last 7 days</Checkbox>
        </HStack>
      </VStack>
      <VStack gap={6} paddingTop={6}>
        <Message />
        <Message />
        <Message />
        <Message />
        <Message />
        <Message />
        <Message />
        <Message />
      </VStack>
    </DashboardLayout>
  );
}

export const getServerSideProps = withSignedInUserAndData(
  async (_context: GetServerSidePropsContext) => {
    return { props: {} };
  }
) satisfies GetServerSideProps<Props>;
