import {
  Avatar,
  Badge,
  Box,
  Button,
  CloseButton,
  createListCollection,
  HStack,
  Input,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Plus, Users } from "react-feather";
import { Select } from "../../components/ui/select";
import { getColorForString } from "../../utils/rotatingColors";

export const AddParticipants = ({
  options,
  annotators,
  setAnnotators,
  queueDrawerOpen,
  sendToQueue,
  isLoading,
}: {
  options: {
    value: string;
    label: string;
  }[];
  annotators: {
    id: string;
    name: string | null;
  }[];
  setAnnotators: (annotators: { id: string; name: string | null }[]) => void;
  queueDrawerOpen: {
    onOpen: () => void;
    onClose: () => void;
  };
  sendToQueue: () => void;
  isLoading: boolean;
}) => {
  const participantsCollection = createListCollection({
    items: options.map((option) => ({
      label: option.label,
      value: option.value,
    })),
  });

  const selectedValues = annotators.map((a) => a.id);
  const participantsLeft = participantsCollection.items.filter(
    (item) => !annotators.some((a) => a.id === item.value)
  );

  return (
    <>
      <VStack width="full" align="start">
        <Text>Send to:</Text>

        <Select.Root
          collection={participantsCollection}
          multiple
          value={selectedValues}
          onValueChange={(newValues) => {
            const selectedOptions = options.filter((opt) =>
              newValues.value.includes(opt.value)
            );
            setAnnotators(
              selectedOptions.map((v) => ({
                id: v.value,
                name: v.label,
              }))
            );
          }}
        >
          <Select.Trigger width="full">
            <Select.ValueText placeholder="Add Participants">
              {(items) => {
                return (
                  <HStack flexWrap="wrap" gap={1} paddingY={2}>
                    {items.map((item) => (
                      <Badge
                        key={item.value}
                        paddingY={1}
                        paddingX={2}
                        borderRadius="full"
                        background="gray.100"
                      >
                        {item.value.startsWith("user-") ? (
                          <Avatar.Root
                            size="2xs"
                            color="white"
                            background={
                              getColorForString("colors", item.label).color
                            }
                          >
                            <Avatar.Fallback name={item.label} />
                          </Avatar.Root>
                        ) : (
                          <Box padding={1}>
                            <Users size={18} />
                          </Box>
                        )}
                        {item.label}
                        <CloseButton
                          size="2xs"
                          color="gray.500"
                          onClick={(e) => {
                            e.stopPropagation();
                            setAnnotators(
                              annotators.filter((a) => a.id !== item.value)
                            );
                          }}
                        />
                      </Badge>
                    ))}
                  </HStack>
                );
              }}
            </Select.ValueText>
          </Select.Trigger>
          <Select.Content maxHeight="300px" portalled={false}>
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
              {participantsLeft.map((item) => (
                <Select.Item key={item.value} item={item}>
                  <VStack align="start">
                    <HStack>
                      {item.value.startsWith("user-") ? (
                        <Avatar.Root
                          size="2xs"
                          color="white"
                          background={
                            getColorForString("colors", item.label).color
                          }
                        >
                          <Avatar.Fallback name={item.label} />
                        </Avatar.Root>
                      ) : (
                        <Box padding={1}>
                          <Users size={18} />
                        </Box>
                      )}
                      <Text>{item.label}</Text>
                    </HStack>
                  </VStack>
                </Select.Item>
              ))}
            </Box>
            {participantsLeft.length == 0 && (
              <Text padding={3} textAlign="center">
                No options
              </Text>
            )}
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
          </Select.Content>
        </Select.Root>
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
