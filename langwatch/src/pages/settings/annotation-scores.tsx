import {
  Button,
  Card,
  CardBody,
  HStack,
  Heading,
  Spacer,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack,
  useToast,
} from "@chakra-ui/react";
import { Plus } from "react-feather";
import { useDrawer } from "~/components/CurrentDrawer";

import { Switch } from "@chakra-ui/react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import SettingsLayout from "../../components/SettingsLayout";
import { api } from "../../utils/api";
import { useEffect } from "react";

const AnnotationScorePage = () => {
  const { project } = useOrganizationTeamProject();
  const toast = useToast();

  const { openDrawer, isDrawerOpen } = useDrawer();

  const getAllAnnotationScores = api.annotationScore.getAll.useQuery(
    {
      projectId: project?.id ?? "",
    },
    { enabled: !!project }
  );

  const toggleAnnotationScore = api.annotationScore.toggle.useMutation();

  const isAnnotationDrawerOpen = isDrawerOpen("addAnnotationScore");

  useEffect(() => {
    void getAllAnnotationScores.refetch();
  }, [isAnnotationDrawerOpen]);

  const handleToggleScore = (scoreId: string, active: boolean) => {
    toggleAnnotationScore.mutate(
      { scoreId, active, projectId: project?.id ?? "" },
      {
        onSuccess: () => {
          void getAllAnnotationScores.refetch();
        },
        onError: () => {
          toast({
            title: "Update score",
            status: "error",
            description: "Failed to update score",
            duration: 6000,
            isClosable: true,
          });
        },
      }
    );
  };

  return (
    <SettingsLayout>
      <VStack
        paddingX={4}
        paddingY={6}
        spacing={6}
        width="full"
        maxWidth="6xl"
        align="start"
      >
        <HStack width="full" marginTop={2}>
          <Heading size="lg" as="h1">
            Annotation Scoring
          </Heading>
          <Spacer />
          <Button
            size="sm"
            colorScheme="orange"
            leftIcon={<Plus size={20} />}
            onClick={() => openDrawer("addAnnotationScore", undefined)}
          >
            Add new score metric
          </Button>
        </HStack>
        <Card width="full">
          <CardBody>
            <Table variant="simple" width="full">
              <Thead>
                <Tr>
                  <Th>Name</Th>
                  <Th>Data Type</Th>
                  <Th>Description</Th>
                  <Th>Options</Th>
                  <Th>Status</Th>
                </Tr>
              </Thead>
              <Tbody>
                {getAllAnnotationScores.data?.map((score) => (
                  <Tr key={score.id}>
                    <Td>{score.name}</Td>
                    <Td>{score.dataType}</Td>
                    <Td>{score.description}</Td>
                    <Td>{JSON.stringify(score.options)}</Td>
                    <Td textAlign="center">
                      <Switch
                        isChecked={score.active}
                        onChange={() => {
                          handleToggleScore(score.id, !score.active);
                        }}
                      />
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </CardBody>
        </Card>
      </VStack>
    </SettingsLayout>
  );
};

export default AnnotationScorePage;
