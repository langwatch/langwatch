import {
  Badge,
  Box,
  Button,
  CloseButton,
  createListCollection,
  HStack,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Plus, Users } from "react-feather";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { Select } from "../../components/ui/select";
import { RandomColorAvatar } from "../RandomColorAvatar";

export const AddParticipants = ({
  annotators,
  setAnnotators,
  queueDrawerOpen,
  sendToQueue,
  isLoading,
  isTrigger = false,
}: {
  annotators: {
    id: string;
    name: string;
  }[];
  setAnnotators: (annotators: { id: string; name: string }[]) => void;
  queueDrawerOpen?: {
    onOpen: () => void;
    onClose: () => void;
  };
  sendToQueue?: () => void;
  isLoading?: boolean;
  isTrigger?: boolean;
}) => {
  const { organization, project } = useOrganizationTeamProject();

  const annotationQueues = api.annotation.getQueues.useQuery(
    {
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project,
    },
  );

  const selectedValues = annotators.map((a) => a.id);

  const users =
    api.organization.getOrganizationWithMembersAndTheirTeams.useQuery(
      {
        organizationId: organization?.id ?? "",
      },
      {
        enabled: !!organization,
      },
    );

  const userOptions = users.data?.members.map((member) => ({
    label: member.user.name ?? "",
    value: `user-${member.user.id}`,
    image: member.user.image ?? null,
  }));

  const queueOptions = annotationQueues.data?.map((queue) => ({
    label: queue.name ?? "",
    value: `queue-${queue.id}`,
    // Queues have no avatar image; keep the option shape uniform for `options`.
    image: null,
  }));

  // Queues first: a queue reaches whoever is on it, so it is the answer most
  // of the time and a person is the exception.
  const options = [...(queueOptions ?? []), ...(userOptions ?? [])];

  const participantsCollection = createListCollection({
    items: options.map((option) => ({
      label: option.label,
      value: option.value,
      image: option.image,
    })),
  });
  const participantsLeft = participantsCollection.items.filter(
    (item) => !annotators.some((a) => a.id === item.value),
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
              newValues.value.includes(opt.value),
            );
            setAnnotators(
              selectedOptions.map((v) => ({
                id: v.value,
                name: v.label,
              })),
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
                        background="bg.muted"
                      >
                        {item.value.startsWith("user-") ? (
                          <RandomColorAvatar
                            size="2xs"
                            name={item.label}
                            image={item.image}
                          />
                        ) : (
                          <Box padding={1}>
                            <Users size={18} />
                          </Box>
                        )}
                        {item.label}
                        <CloseButton
                          size="2xs"
                          color="fg.muted"
                          onClick={(e) => {
                            e.stopPropagation();
                            setAnnotators(
                              annotators.filter((a) => a.id !== item.value),
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
          {/*
            #6716: this listbox sat unclickable when the automation drawer's
            annotation-queue config renders it inside the secondary
            (Configuration) drawer stacked on top of the main composer —
            `portalled={false}` puts the floating listbox in the DOM as a
            normal descendant instead of routing it through the shared
            z-index-safe portal every other Select in the app uses
            (`components/ui/select.tsx`'s `useOverlayZIndex`, added for
            exactly this "selects can render behind another overlay" class of
            bug, see #2519). The listbox rendered fine within a single
            drawer, so its clicks reached the combobox trigger but never the
            options underneath the stacked drawer body. Portalling (the
            default) fixes it in every context, single or nested drawer alike.
          */}
          <Select.Content maxHeight="300px">
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
                        <RandomColorAvatar
                          size="2xs"
                          name={item.label}
                          image={item.image}
                        />
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
              bg="bg.panel"
              borderTop="1px solid"
              borderColor="border.muted"
            >
              <Button
                width="100%"
                colorPalette="blue"
                onClick={queueDrawerOpen?.onOpen}
                variant="outline"
                size="sm"
              >
                <Plus /> Add New Queue
              </Button>
            </Box>
          </Select.Content>
        </Select.Root>
        <Spacer />
        <HStack width="full" hidden={isTrigger}>
          <Spacer />
          <Button
            colorPalette="orange"
            disabled={annotators.length == 0}
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
