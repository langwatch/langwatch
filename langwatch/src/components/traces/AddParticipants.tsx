import {
  Avatar,
  Box,
  Button,
  HStack,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Plus, Users } from "react-feather";

import { chakraComponents, Select as MultiSelect } from "chakra-react-select";

export const AddParticipants = ({
  options,
  annotators,
  setAnnotators,
  queueDrawerOpen,
  sendToQueue,
  isLoading,
}: {
  options: any[];
  annotators: any[];
  setAnnotators: any;
  queueDrawerOpen: any;
  sendToQueue: () => void;
  isLoading: boolean;
}) => {
  return (
    <>
      <VStack width="full" align="start">
        <Text>Send to:</Text>
        <Box
          border="1px solid lightgray"
          borderRadius={5}
          paddingX={1}
          minWidth="300px"
        >
          <MultiSelect
            options={options}
            onChange={(newValue) => {
              setAnnotators(
                newValue.map((v) => ({
                  id: v.value,
                  name: v.label,
                }))
              );
            }}
            value={annotators.map((p) => ({
              value: p.id,
              label: p.name ?? "",
            }))}
            isMulti
            closeMenuOnSelect={false}
            selectedOptionStyle="check"
            hideSelectedOptions={true}
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
                      {props.data.value.startsWith("user-") ? (
                        <Avatar.Root size="xs">
                          <Avatar.Fallback name={props.data.label} color="white" />
                        </Avatar.Root>
                      ) : (
                        <Box padding={1}>
                          <Users size={18} />
                        </Box>
                      )}
                      <Text>{children}</Text>
                    </HStack>
                  </VStack>
                </chakraComponents.Option>
              ),
              MultiValueLabel: ({ children, ...props }) => (
                <chakraComponents.MultiValueLabel {...props}>
                  <VStack align="start" padding={1} paddingX={0}>
                    <HStack>
                      {props.data.value.startsWith("user-") ? (
                        <Avatar.Root size="xs">
                          <Avatar.Fallback name={props.data.label} color="white" />
                        </Avatar.Root>
                      ) : (
                        <Box padding={1}>
                          <Users size={18} />
                        </Box>
                      )}
                      <Text>{children}</Text>
                    </HStack>
                  </VStack>
                </chakraComponents.MultiValueLabel>
              ),
              MenuList: (props) => (
                <chakraComponents.MenuList {...props} maxHeight={300}>
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
                      colorPalette="blue"
                      onClick={queueDrawerOpen.onOpen}
                      variant="outline"
                      size="sm"
                    >
                      <Plus /> Add New Queue
                    </Button>
                  </Box>
                </chakraComponents.MenuList>
              ),
            }}
          />
        </Box>
        <Spacer />
        <HStack width="full">
          <Spacer />
          <Button
            colorPalette="orange"
            size="sm"
            onClick={sendToQueue}
            loading={isLoading}
          >
            Send
          </Button>
        </HStack>
      </VStack>
    </>
  );
};
