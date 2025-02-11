import {
  Avatar,
  Box,
  Button,
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerHeader,
  FormControl,
  FormHelperText,
  FormLabel,
  HStack,
  Input,
  Spacer,
  Text,
  Textarea,
  VStack,
  useDisclosure,
  useToast,
} from "@chakra-ui/react";
import { useState } from "react";
import { Plus } from "react-feather";
import { useForm } from "react-hook-form";
import slugify from "slugify";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useDrawer } from "./CurrentDrawer";
import { FullWidthFormControl } from "./FullWidthFormControl";

import { AddAnnotationScoreDrawer } from "./AddAnnotationScoreDrawer";

import { Select as MultiSelect, chakraComponents } from "chakra-react-select";

export const AddAnnotationQueueDrawer = ({
  onClose,
  onOverlayClick,
  queueId,
}: {
  onClose?: () => void;
  onOverlayClick?: () => void;
  queueId?: string;
}) => {
  const { project, organization } = useOrganizationTeamProject();
  const toast = useToast();
  const createOrUpdateQueue = api.annotation.createOrUpdateQueue.useMutation();

  const queue = api.annotation.getQueueById.useQuery(
    {
      queueId: queueId ?? "",
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project,
    }
  );

  const handleClose = () => {
    if (onOverlayClick) {
      onClose?.();
      onOverlayClick();
    } else {
      closeDrawer();
    }
  };

  const queryClient = api.useContext();

  const annotationScores = api.annotationScore.getAllActive.useQuery(
    {
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project,
    }
  );

  const { closeDrawer } = useDrawer();

  const users =
    api.organization.getOrganizationWithMembersAndTheirTeams.useQuery(
      {
        organizationId: organization?.id ?? "",
      },
      {
        enabled: !!organization,
      }
    );
  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    watch,
  } = useForm({
    defaultValues: {
      name: queue.data?.name ?? "",
      description: queue.data?.description ?? "",
    },
  });

  type FormData = {
    name: string;
    description?: string | null;
  };

  const [participants, setParticipants] = useState<
    { id: string; name: string | null }[]
  >(
    queue.data?.members.map((member) => ({
      id: member.user.id,
      name: member.user.name,
    })) ?? []
  );

  const [scoreTypes, setScoreTypes] = useState<
    { id: string; name: string | null }[]
  >(
    queue.data?.AnnotationQueueScores.map((score) => ({
      id: score.annotationScore.id,
      name: score.annotationScore.name,
    })) ?? []
  );

  const onSubmit = (data: FormData) => {
    if (participants.length === 0 || scoreTypes.length === 0) {
      toast({
        title: "Error",
        description: "Please select at least one participant and score type",
        status: "error",
      });
      return;
    }
    createOrUpdateQueue.mutate(
      {
        name: data.name,
        description: data.description ?? "",
        userIds: participants.map((p) => p.id),
        projectId: project?.id ?? "",
        scoreTypeIds: scoreTypes.map((s) => s.id),
        queueId: queueId,
      },
      {
        onSuccess: (data) => {
          void queryClient.annotation.getQueues.invalidate();
          void queryClient.annotation.getQueues.refetch();
          void queryClient.annotation.getQueueById.invalidate();
          void queryClient.annotation.getQueueById.refetch();
          toast({
            title: `Annotation Queue ${queueId ? "Updated" : "Created"}`,
            description: `Successfully ${queueId ? "updated" : "created"} ${
              data.name
            } annotation queue`,
            status: "success",
            duration: 5000,
            isClosable: true,
            position: "top-right",
          });
          handleClose();
          reset();
        },
        onError: (error) => {
          toast({
            title: "Error creating annotation score",
            description: error.message,
            status: "error",
            duration: 5000,
            isClosable: true,
            position: "top-right",
          });
        },
      }
    );
  };

  const scoreTypeDrawerOpen = useDisclosure();

  const name = watch("name");
  const slug = slugify((name || "").replace("_", "-"), {
    lower: true,
    strict: true,
  });

  return (
    <>
      <Drawer
        isOpen={true}
        placement="right"
        size={"lg"}
        onClose={handleClose}
        onOverlayClick={handleClose}
      >
        <DrawerContent>
          <DrawerHeader>
            <HStack>
              <DrawerCloseButton />
            </HStack>
            <HStack>
              <Text paddingTop={5} fontSize="2xl">
                Create Annotation Queue
              </Text>
            </HStack>
          </DrawerHeader>
          <DrawerBody>
            {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
            <form onSubmit={handleSubmit(onSubmit)}>
              <VStack align="start">
                <Box
                  border="1px solid lightgray"
                  borderRadius={5}
                  paddingX={1}
                  minWidth="300px"
                >
                  <MultiSelect
                    options={users.data?.members.map((member) => ({
                      label: member.user.name ?? "",
                      value: member.user.id,
                    }))}
                    onChange={(newValue) => {
                      setParticipants(
                        newValue.map((v) => ({
                          id: v.value,
                          name: v.label,
                        }))
                      );
                    }}
                    value={participants.map((p) => ({
                      value: p.id,
                      label: p.name ?? "",
                    }))}
                    isMulti
                    closeMenuOnSelect={false}
                    selectedOptionStyle="check"
                    hideSelectedOptions={true}
                    useBasicStyles
                    variant="unstyled"
                    placeholder="Add Participants"
                    components={{
                      Menu: ({ children, ...props }) => (
                        <chakraComponents.Menu
                          {...props}
                          innerProps={{
                            ...props.innerProps,
                            style: { width: "300px" },
                          }}
                        >
                          {children}
                        </chakraComponents.Menu>
                      ),
                      Option: ({ children, ...props }) => (
                        <chakraComponents.Option {...props}>
                          <VStack align="start">
                            <HStack>
                              <Avatar
                                name={props.data.label}
                                color="white"
                                size="xs"
                              />
                              <Text>{children}</Text>
                            </HStack>
                          </VStack>
                        </chakraComponents.Option>
                      ),
                      MultiValueLabel: ({ children, ...props }) => (
                        <chakraComponents.MultiValueLabel {...props}>
                          <VStack align="start" padding={1} paddingX={0}>
                            <HStack>
                              <Avatar
                                name={props.data.label}
                                color="white"
                                size="xs"
                              />
                              <Text>{children}</Text>
                            </HStack>
                          </VStack>
                        </chakraComponents.MultiValueLabel>
                      ),
                    }}
                  />
                </Box>

                <FullWidthFormControl
                  label="Name Annotation Queue"
                  helper="Give it a name to identify this annotation queue"
                  isInvalid={!!errors.name}
                >
                  <Input {...register("name")} required />
                  {slug && <FormHelperText>slug: {slug}</FormHelperText>}
                </FullWidthFormControl>

                <FullWidthFormControl
                  label="Description"
                  helper="Provide a description of the annotation"
                  isInvalid={!!errors.description}
                >
                  <Textarea {...register("description")} required />
                </FullWidthFormControl>

                <FormControl>
                  <VStack align="start" spacing={1}>
                    <FormLabel margin={0}>Score Type</FormLabel>
                    <FormHelperText margin={0}>
                      Select the score type for this annotation queue
                    </FormHelperText>
                    <Box
                      border="1px solid lightgray"
                      borderRadius={5}
                      paddingX={1}
                      minWidth="300px"
                      marginTop={3}
                    >
                      <MultiSelect
                        options={annotationScores.data?.map((score) => ({
                          label: score.name,
                          value: score.id,
                        }))}
                        onChange={(newValue) => {
                          setScoreTypes(
                            newValue.map((v) => ({
                              id: v.value,
                              name: v.label,
                            }))
                          );
                        }}
                        value={scoreTypes.map((v) => ({
                          value: v.id,
                          label: v.name ?? "",
                        }))}
                        isMulti
                        closeMenuOnSelect={false}
                        selectedOptionStyle="check"
                        hideSelectedOptions={true}
                        useBasicStyles
                        variant="unstyled"
                        placeholder="Add Score Type"
                        components={{
                          Menu: ({ children, ...props }) => (
                            <chakraComponents.Menu
                              {...props}
                              innerProps={{
                                ...props.innerProps,
                                style: { width: "300px" },
                              }}
                            >
                              {children}
                            </chakraComponents.Menu>
                          ),
                          MultiValueLabel: ({ children, ...props }) => (
                            <chakraComponents.MultiValueLabel {...props}>
                              <VStack align="start" padding={1} paddingX={0}>
                                <HStack>
                                  <Text>{props.data.label}</Text>
                                </HStack>
                              </VStack>
                            </chakraComponents.MultiValueLabel>
                          ),
                          MenuList: (props) => (
                            <chakraComponents.MenuList
                              {...props}
                              maxHeight={300}
                            >
                              <Box
                                maxH="250px"
                                overflowY="auto"
                                css={{
                                  "&::-webkit-scrollbar": {
                                    display: "none",
                                  },
                                  msOverflowStyle: "none", // IE and Edge
                                  scrollbarWidth: "none", // Firefox
                                }}
                              >
                                {props.children}
                              </Box>
                              <Box
                                p={2}
                                position="sticky"
                                bottom={0}
                                bg="white"
                                borderTop="1px solid"
                                borderColor="gray.100"
                              >
                                <Button
                                  width="100%"
                                  colorScheme="blue"
                                  onClick={scoreTypeDrawerOpen.onOpen}
                                  leftIcon={<Plus />}
                                  variant="outline"
                                  size="sm"
                                >
                                  Add New
                                </Button>
                              </Box>
                            </chakraComponents.MenuList>
                          ),
                        }}
                      />
                    </Box>
                  </VStack>
                </FormControl>
                <HStack width="full">
                  <Spacer />
                  <Button
                    colorScheme="orange"
                    type="submit"
                    minWidth="fit-content"
                  >
                    Save
                  </Button>
                </HStack>
              </VStack>
            </form>
          </DrawerBody>
        </DrawerContent>
      </Drawer>
      <Drawer
        isOpen={scoreTypeDrawerOpen.isOpen}
        placement="right"
        size={"lg"}
        onClose={scoreTypeDrawerOpen.onClose}
        onOverlayClick={scoreTypeDrawerOpen.onClose}
      >
        <AddAnnotationScoreDrawer
          onClose={scoreTypeDrawerOpen.onClose}
          onOverlayClick={scoreTypeDrawerOpen.onClose}
        />
      </Drawer>
    </>
  );
};
