import {
  Button,
  Card,
  CardBody,
  HStack,
  Heading,
  Link,
  Spacer,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack,
  useToast,
  Text,
  RadioGroup,
  Radio,
  Checkbox,
  CheckboxGroup,
  Tag,
} from "@chakra-ui/react";
import { Bell, Plus, ThumbsUp } from "react-feather";
import { useDrawer } from "~/components/CurrentDrawer";
import { CheckIcon } from "@chakra-ui/icons";
import { AnnotationScoreDataType } from "@prisma/client";

import { Switch } from "@chakra-ui/react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import SettingsLayout from "../../components/SettingsLayout";
import { api } from "../../utils/api";
import { useEffect } from "react";
import { NoDataInfoBlock } from "~/components/NoDataInfoBlock";

const AnnotationScorePage = () => {
  const { project } = useOrganizationTeamProject();
  const toast = useToast();

  const { openDrawer, drawerOpen: isDrawerOpen } = useDrawer();

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
        gap={6}
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
            colorPalette="orange"
            leftIcon={<Plus size={20} />}
            onClick={() => openDrawer("addAnnotationScore")}
          >
            Add new score metric
          </Button>
        </HStack>
        <Card width="full">
          <CardBody>
            {getAllAnnotationScores.data &&
            getAllAnnotationScores.data.length == 0 ? (
              <NoDataInfoBlock
                title="No scoring setup yet"
                description="Add new scoring metrics for your annotations."
                docsInfo={
                  <Text>
                    To learn more about scores and how to use them, please visit
                    our{" "}
                    <Link
                      color="orange.400"
                      href="https://docs.langwatch.ai/features/annotations#annotation-scoring"
                      target="_blank"
                    >
                      documentation
                    </Link>
                    .
                  </Text>
                }
                icon={<ThumbsUp />}
              />
            ) : (
              <Table variant="simple" width="full">
                <Thead>
                  <Tr>
                    <Th>Name</Th>
                    <Th>Description</Th>
                    <Th>Score Type</Th>
                    <Th>Score Options</Th>
                    <Th>Status</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {getAllAnnotationScores.data?.map((score) => (
                    <Tr key={score.id}>
                      <Td>{score.name}</Td>
                      <Td>{score.description}</Td>
                      <Td width="20%">
                        <Text lineClamp={1}>
                          {score.dataType === AnnotationScoreDataType.CHECKBOX
                            ? "Checkbox"
                            : "Multiple choice"}
                        </Text>
                      </Td>
                      <Td>
                        <ScoreOptions
                          options={
                            Array.isArray(score.options)
                              ? (score.options as {
                                  label: string;
                                  value: number;
                                }[])
                              : []
                          }
                          dataType={score.dataType ?? ""}
                        />
                      </Td>
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
            )}
          </CardBody>
        </Card>
      </VStack>
    </SettingsLayout>
  );
};

export default AnnotationScorePage;

const ScoreOptions = ({
  options,
  dataType,
}: {
  options: { label: string; value: number }[];
  dataType: string;
}) => {
  return (
    <>
      {dataType === "CHECKBOX" ? (
        <HStack>
          <HStack flexWrap="wrap" gap={2} gap={4}>
            {options.map((option) => (
              <Tag key={option.value}>{option.label}</Tag>
            ))}
          </HStack>
        </HStack>
      ) : (
        <HStack>
          <HStack flexWrap="wrap" gap={2} gap={4}>
            {options.map((option) => (
              <Tag key={option.value}>{option.label}</Tag>
            ))}
          </HStack>
        </HStack>
      )}
    </>
  );
};
