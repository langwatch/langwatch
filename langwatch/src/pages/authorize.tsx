import {
  Card,
  CardBody,
  CardHeader,
  Container,
  HStack,
  Heading,
  Input,
  InputGroup,
  InputRightElement,
  Spacer,
  Text,
  VStack,
  useToast,
  type InputGroupProps,
} from "@chakra-ui/react";
import { Copy } from "react-feather";
import {
  DashboardLayout,
  ProjectSelector,
} from "../components/DashboardLayout";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";

export default function Authorize() {
  const { organizations, project } = useOrganizationTeamProject();

  return (
    <DashboardLayout>
      <Container paddingTop="200px">
        <Card>
          <CardHeader>
            <HStack width="full" align="center">
              <Heading as="h1" size="md">
                Authorize
              </Heading>
              <Spacer />
              {organizations && project && (
                <ProjectSelector
                  organizations={organizations}
                  project={project}
                />
              )}
            </HStack>
          </CardHeader>
          <CardBody>
            <VStack spacing={6}>
              <Text>
                Copy your LangWatch API key below and paste it into your command
                line or notebook to authorize it.
              </Text>
              <APIKeyCopyInput />
            </VStack>
          </CardBody>
        </Card>
      </Container>
    </DashboardLayout>
  );
}

export function APIKeyCopyInput(props: InputGroupProps) {
  const { project } = useOrganizationTeamProject();
  const toast = useToast();

  return (
    <InputGroup
      {...props}
      cursor="pointer"
      onClick={() => {
        if (!navigator.clipboard) {
          toast({
            title:
              "Your browser does not support clipboard access, please copy the key manually",
            status: "error",
            duration: 2000,
            isClosable: true,
          });
          return;
        }

        void (async () => {
          await navigator.clipboard.writeText(project?.apiKey ?? "");
          toast({
            title: "API key copied to your clipboard",
            status: "success",
            duration: 2000,
            isClosable: true,
          });
        })();
      }}
    >
      <Input
        cursor="pointer"
        type="text"
        value={project?.apiKey}
        isReadOnly
        _hover={{
          backgroundColor: "gray.50",
        }}
      />
      <InputRightElement>
        <Copy />
      </InputRightElement>
    </InputGroup>
  );
}
