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
import { TriggerAction } from "@prisma/client";
import { useDrawer } from "~/components/CurrentDrawer";

import { HorizontalFormControl } from "./HorizontalFormControl";

import { useFilterParams } from "~/hooks/useFilterParams";

import { useForm } from "react-hook-form";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

export function TriggerDrawer() {
  const { project, organization } = useOrganizationTeamProject();
  const { onOpen, onClose, isOpen } = useDisclosure();

  const toast = useToast();
  const createTrigger = api.trigger.create.useMutation();

  const organizationWithMembers =
    api.organization.getOrganizationWithMembersAndTheirTeams.useQuery(
      {
        organizationId: organization?.id ?? "",
      },
      { enabled: !!organization }
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
    },
  });

  const currentAction = watch("action");

  const onSubmit = (data: any) => {
    createTrigger.mutate(
      {
        projectId: project?.id ?? "",
        name: data.name,
        action: data.action,
        filters: filterParams.filters,
        organizationId: organization?.id ?? "",
        members: data.members,
      },
      {
        onSuccess: () => {
          toast({
            title: "Alert Created",
            description: `You have successfully created an alert`,

            status: "success",
            duration: 5000,
            isClosable: true,
            position: "top-right",
          });
          reset();
          closeDrawer();
        },
        onError: (error) => {
          toast({
            title: "Error",
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
                  {organizationWithMembers.data &&
                    organizationWithMembers.data?.members.map((member) => {
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
                      // <FormControl marginTop={2} paddingLeft={6}>
                      //   <Input
                      //     placeholder="your email"
                      //     type="email"
                      //     value={email}
                      //     required
                      //     {...register("email")}
                      //   />
                      //   <FormErrorMessage>
                      //     {errors.email?.message}
                      //   </FormErrorMessage>
                      // </FormControl>
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
