import {
  Button,
  Checkbox,
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerHeader,
  FormControl,
  FormErrorMessage,
  HStack,
  Input,
  Popover,
  PopoverBody,
  PopoverCloseButton,
  PopoverContent,
  PopoverTrigger,
  Radio,
  RadioGroup,
  Stack,
  Text,
  VStack,
  useDisclosure,
  useToast,
} from "@chakra-ui/react";
import { TriggerAction, type Trigger } from "@prisma/client";
import { useDrawer } from "~/components/CurrentDrawer";

import { HorizontalFormControl } from "./HorizontalFormControl";

import { useFilterParams } from "~/hooks/useFilterParams";

import { useForm } from "react-hook-form";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

export function TriggerDrawer() {
  const { project, organization, team } = useOrganizationTeamProject();
  const { onOpen, onClose, isOpen } = useDisclosure();

  const toast = useToast();
  const createTrigger = api.trigger.create.useMutation();
  const teamSlug = team?.slug;

  const teamWithMembers = api.team.getTeamWithMembers.useQuery(
    {
      slug: teamSlug ?? "",
      organizationId: organization?.id ?? "",
    },
    { enabled: typeof teamSlug === "string" && !!organization?.id }
  );

  const { closeDrawer } = useDrawer();

  const { filterParams } = useFilterParams();

  const {
    register,
    handleSubmit,
    watch,
    getValues,
    formState: { errors },
    reset,
  } = useForm({
    defaultValues: {
      name: "",
      action: TriggerAction.SEND_EMAIL,
      email: "",
      members: [],
      slackWebhook: "",
    },
  });

  const currentAction: TriggerAction = watch("action");

  type Trigger = {
    name: string;
    action: TriggerAction;
    email?: string;
    members?: string[];
    slackWebhook?: string;
  };

  type ActionParams = {
    members?: string[];
    slackWebhook?: string;
  };

  const onSubmit = (data: Trigger) => {
    let actionParams: ActionParams = {
      members: [],
      slackWebhook: "",
    };
    if (data.action === TriggerAction.SEND_EMAIL) {
      actionParams = {
        members: data.members ?? [],
      };
    } else if (data.action === TriggerAction.SEND_SLACK_MESSAGE) {
      actionParams = {
        slackWebhook: data.slackWebhook ?? "",
      };
    }

    createTrigger.mutate(
      {
        projectId: project?.id ?? "",
        name: data.name,
        action: data.action,
        filters: filterParams.filters,
        actionParams: actionParams,
      },
      {
        onSuccess: () => {
          toast({
            title: "Trigger Created",
            description: `You have successfully created a trigger`,

            status: "success",
            duration: 5000,
            isClosable: true,
            position: "top-right",
          });
          reset();
          closeDrawer();
        },
        onError: () => {
          toast({
            title: "Error",
            description: "Error creating trigger",
            status: "error",
            duration: 5000,
            isClosable: true,
            position: "top-right",
          });
        },
      }
    );
  };

  const MultiSelect = () => {
    const members = watch("members");
    return (
      <>
        <Popover
          placement="bottom"
          matchWidth={true}
          isOpen={isOpen}
          onOpen={onOpen}
          onClose={onClose}
        >
          <PopoverTrigger>
            <FormControl isInvalid={!!errors.members}>
              <Input
                placeholder="Select email/s"
                defaultValue={members}
                readOnly
                {...register("members", {
                  required: "Please select at least one member",
                })}
              />
              <FormErrorMessage>{errors.members?.message}</FormErrorMessage>
            </FormControl>
          </PopoverTrigger>
          <PopoverContent marginTop="-8px" width="100%">
            <PopoverCloseButton onClick={onClose} zIndex={1000} />
            <PopoverBody>
              <FormControl>
                <Stack spacing={5} direction="column" marginRight={4}>
                  {teamWithMembers.data &&
                    teamWithMembers.data?.members.map((member) => {
                      return (
                        <Checkbox
                          key={member.user.id}
                          {...register("members")}
                          value={member.user!.email ?? ""}
                        >
                          {member.user.email}
                        </Checkbox>
                      );
                    })}
                </Stack>
              </FormControl>
            </PopoverBody>
          </PopoverContent>
        </Popover>
      </>
    );
  };

  return (
    <Drawer
      isOpen={true}
      placement="right"
      size={"xl"}
      onClose={closeDrawer}
      onOverlayClick={onClose}
    >
      <DrawerContent>
        <DrawerHeader>
          <HStack>
            <DrawerCloseButton />
          </HStack>
          <HStack>
            <Text paddingTop={5} fontSize="2xl">
              Add Trigger
            </Text>
          </HStack>
        </DrawerHeader>
        <DrawerBody>
          {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
          <form onSubmit={handleSubmit(onSubmit)}>
            <HorizontalFormControl
              label="Name"
              helper="Give it a name that identifies what trigger it might be"
              isInvalid={!!errors.name}
            >
              <Input
                placeholder="Evaluation trigger"
                required
                {...register("name")}
              />
              <FormErrorMessage>{errors.name?.message}</FormErrorMessage>
            </HorizontalFormControl>

            <HorizontalFormControl
              label="Action"
              helper="Select action you would like to take once a your trigger has taken place."
              minWidth="calc(50% - 16px)"
            >
              <RadioGroup defaultValue={TriggerAction.SEND_EMAIL}>
                <Stack spacing={4}>
                  <VStack align="start">
                    <Radio
                      size="md"
                      value={TriggerAction.SEND_EMAIL}
                      colorScheme="blue"
                      alignItems="start"
                      spacing={3}
                      paddingTop={2}
                      {...register("action")}
                    >
                      <Text fontWeight="500">Email</Text>
                      <Text fontSize={13}>
                        Receive an email with the details and the items that
                        triggered the alert.
                      </Text>
                    </Radio>
                    {currentAction === TriggerAction.SEND_EMAIL && (
                      <MultiSelect />
                    )}
                  </VStack>
                  <VStack align="start">
                    <Radio
                      size="md"
                      value={TriggerAction.SEND_SLACK_MESSAGE}
                      colorScheme="blue"
                      alignItems="start"
                      spacing={3}
                      paddingTop={2}
                      {...register("action")}
                    >
                      <VStack align="start" marginTop={-1}>
                        <Text fontWeight="500">Send Slack Message</Text>
                        <Text fontSize={13}>
                          Add your slack webhook url to send a message to when
                          the trigger is activated.
                        </Text>
                      </VStack>
                    </Radio>
                    {currentAction ===
                      (TriggerAction.SEND_SLACK_MESSAGE as TriggerAction) && (
                      <Input
                        placeholder="Your slack hook url"
                        required
                        {...register("slackWebhook")}
                      />
                    )}
                  </VStack>
                  <VStack align="start">
                    <Radio
                      size="md"
                      value={TriggerAction.ADD_TO_DATASET}
                      colorScheme="blue"
                      alignItems="start"
                      spacing={3}
                      paddingTop={2}
                      isDisabled={true}
                      {...register("action")}
                    >
                      <VStack align="start" marginTop={-1}>
                        <Text fontWeight="500">Add to Dataset</Text>
                        <Text fontSize={13}>
                          Add entries to the dataset, this allows you to keep
                          track of the results of your triggers.
                        </Text>
                      </VStack>
                    </Radio>
                  </VStack>
                </Stack>
              </RadioGroup>
            </HorizontalFormControl>
            <Button
              colorScheme="blue"
              type="submit"
              minWidth="fit-content"
              isLoading={createTrigger.isLoading}
            >
              Add Trigger
            </Button>
          </form>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
