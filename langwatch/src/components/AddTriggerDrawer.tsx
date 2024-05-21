import {
  Button,
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerHeader,
  FormControl,
  FormErrorMessage,
  HStack,
  Input,
  Radio,
  RadioGroup,
  Stack,
  Text,
  VStack,
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
  const { project } = useOrganizationTeamProject();
  const toast = useToast();
  const createTrigger = api.trigger.create.useMutation();
  const { closeDrawer } = useDrawer();

  const { filterParams } = useFilterParams();

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
    reset,
  } = useForm({
    defaultValues: {
      name: "",
      action: TriggerAction.SEND_EMAIL,
      email: "",
    },
  });

  const currentAction = watch("action");
  const email = watch("email");

  console.log(currentAction);

  const onSubmit = (data: any) => {
    let actionParams;
    if (data.action === TriggerAction.SEND_EMAIL) {
      actionParams = {
        email: data.email,
      };
    } else if (data.action === TriggerAction.ADD_TO_DATASET) {
      actionParams = {
        datasetId: "yy",
      };
    }
    console.log("sdasds", {
      projectId: project?.id ?? "",
      email: data.email,
      name: data.name,
      action: data.action,
      actionParams: actionParams,
      filters: filterParams.filters,
    });

    createTrigger.mutate(
      {
        projectId: project?.id ?? "",
        email: data.email,
        name: data.name,
        action: data.action,
        actionParams: actionParams,
        filters: filterParams.filters,
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
      }
    );
  };

  return (
    <Drawer isOpen={true} placement="right" size={"xl"} onClose={closeDrawer}>
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
                      <FormControl marginTop={2} paddingLeft={6}>
                        <Input
                          placeholder="your email"
                          type="email"
                          value={email}
                          {...register("email")}
                        />
                        <FormErrorMessage>
                          {errors.email?.message}
                        </FormErrorMessage>
                      </FormControl>
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

            <Button colorScheme="blue" type="submit" minWidth="fit-content">
              Add Trigger
            </Button>
          </form>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
