import {
  Box,
  Button,
  Container,
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerHeader,
  FormControl,
  FormErrorMessage,
  FormHelperText,
  HStack,
  Input,
  Radio,
  RadioGroup,
  Stack,
  VStack,
  useToast,
  Text,
  Spacer,
  FormLabel,
  Checkbox,
} from "@chakra-ui/react";
import { RuleAction } from "@prisma/client";
import { useDrawer } from "~/components/CurrentDrawer";
import { useFilterParams } from "~/hooks/useFilterParams";

import { useState, useEffect } from "react";
import { api } from "~/utils/api";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

export function RuleDrawer() {
  const { filterParams } = useFilterParams();
  const [email, setEmail] = useState<string>("");
  const [action, setAction] = useState<RuleAction>(RuleAction.EMAIL);
  const [name, setName] = useState<string>("");

  const { project } = useOrganizationTeamProject();

  const { closeDrawer } = useDrawer();
  const toast = useToast();

  const createRule = api.rules.create.useMutation();

  const onSubmit = (e: any) => {
    e.preventDefault();

    let actionParams;
    if (action === RuleAction.EMAIL) {
      actionParams = {
        email,
      };
    } else if (action === RuleAction.DATASET) {
      actionParams = {
        datasetId: "yy",
      };
    }
    console.log(
      "sdasds",
      project?.id ?? "",
      email,
      name,
      action,
      actionParams,
      filterParams.filters
    );

    createRule.mutate(
      {
        projectId: project?.id ?? "",
        email: email,
        name: name,
        action: action,
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
          closeDrawer();
        },
      }
    );
  };

  return (
    <Drawer isOpen={true} placement="right" size={"lg"} onClose={closeDrawer}>
      <DrawerContent>
        <DrawerHeader>
          <HStack>
            <DrawerCloseButton />
          </HStack>
          <HStack>
            <Text paddingTop={5} fontSize="2xl">
              Add Rule
            </Text>
          </HStack>
          <Text fontSize="sm" fontWeight="normal">
            Create a new automation based on the selected filters.
          </Text>
        </DrawerHeader>
        <DrawerBody>
          <form onSubmit={onSubmit}>
            <VStack align={"start"} spacing={6}>
              <FormControl>
                <FormLabel>Name</FormLabel>
                <Input
                  placeholder=""
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </FormControl>
              <Text fontWeight={"bold"}>Actions:</Text>
              <RadioGroup
                value={action}
                onChange={(value) => setAction(value as RuleAction)}
              >
                <Stack spacing={4}>
                  <HStack align={"start"}>
                    <Radio
                      size="md"
                      colorScheme="blue"
                      padding={1}
                      value={RuleAction.EMAIL}
                    />
                    <Box>
                      <Text fontWeight="bold">Email</Text>
                      <Text>
                        Get sent an email with the results of the evaluation
                        checks.
                      </Text>
                      {action === RuleAction.EMAIL && (
                        <FormControl marginTop={2}>
                          <Input
                            placeholder="your email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                          />
                        </FormControl>
                      )}
                    </Box>
                  </HStack>
                  <HStack align={"start"}>
                    <Radio
                      size="md"
                      colorScheme="blue"
                      padding={1}
                      value={RuleAction.DATASET}
                    />
                    <Box>
                      <Text fontWeight="bold">Add to Dataset</Text>
                      <Text>
                        Add entry to the dataset, this allows you to keep track
                        of the results of the evaluation checks.
                      </Text>
                    </Box>
                  </HStack>
                </Stack>
              </RadioGroup>
            </VStack>

            <HStack>
              <Spacer />
              <Button colorScheme="blue" type="submit" minWidth="fit-content">
                Add Rule
              </Button>
            </HStack>
          </form>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
