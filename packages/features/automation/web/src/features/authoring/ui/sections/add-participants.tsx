/**
 * Who an annotation-queue automation sends its matched traces to.
 *
 * A family-local copy of `platform/app`'s `components/traces/AddParticipants`,
 * narrowed to the one caller that travels with this move. The application's
 * version serves the trace drawer too, where the same control also sends a
 * trace to a queue immediately and offers "Add New Queue"; on this surface both
 * were already inert — the automation provider passed a no-op for the drawer
 * and `isTrigger` hid the send button — so the copy is the half that was ever
 * live here.
 *
 * The avatar is a coloured initial rather than the application's
 * `RandomColorAvatar`: that one reaches the member's uploaded photo, which this
 * read does not carry, and a letter in a stable colour is what it fell back to
 * for everyone else anyway.
 */

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
import { Select } from "@langwatch/design-system/select";
import { Users } from "react-feather";
import { api } from "../../../../behavior/automation-api";
import { useOrganizationTeamProject } from "../../../../behavior/automation-session";
import { ParticipantAvatar } from "../elements/participant-avatar";

export type AutomationParticipant = { id: string; name: string };

export function AddParticipants({
  annotators,
  setAnnotators,
}: {
  annotators: AutomationParticipant[];
  setAnnotators: (annotators: AutomationParticipant[]) => void;
}) {
  const { organization, project } = useOrganizationTeamProject();

  const annotationQueues = api.annotation.getQueues.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project },
  );

  const users = api.organization.getOrganizationWithMembersAndTheirTeams.useQuery(
    { organizationId: organization?.id ?? "" },
    { enabled: !!organization },
  );

  const selectedValues = annotators.map((annotator) => annotator.id);

  const userOptions = (users.data?.members ?? []).map((member) => ({
    label: member.user.name ?? "",
    value: `user-${member.user.id}`,
  }));

  const queueOptions = (annotationQueues.data ?? []).map((queue) => ({
    label: queue.name ?? "",
    value: `queue-${queue.id}`,
  }));

  // Queues first: a queue reaches whoever is on it, so it is the answer most
  // of the time and a person is the exception.
  const options = [...queueOptions, ...userOptions];

  const participantsCollection = createListCollection({ items: options });
  const participantsLeft = participantsCollection.items.filter(
    (item) => !annotators.some((annotator) => annotator.id === item.value),
  );

  return (
    <VStack width="full" align="start">
      <Text>Send to:</Text>

      <Select.Root
        collection={participantsCollection}
        multiple
        value={selectedValues}
        onValueChange={(next) => {
          const selected = options.filter((option) => next.value.includes(option.value));
          setAnnotators(selected.map((option) => ({ id: option.value, name: option.label })));
        }}
      >
        <Select.Trigger width="full">
          <Select.ValueText placeholder="Add Participants">
            {(items) => (
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
                      <ParticipantAvatar name={item.label} />
                    ) : (
                      <Box padding={1}>
                        <Users size={18} />
                      </Box>
                    )}
                    {item.label}
                    <CloseButton
                      size="2xs"
                      color="fg.muted"
                      onClick={(event) => {
                        event.stopPropagation();
                        setAnnotators(
                          annotators.filter((annotator) => annotator.id !== item.value),
                        );
                      }}
                    />
                  </Badge>
                ))}
              </HStack>
            )}
          </Select.ValueText>
        </Select.Trigger>
        <Select.Content maxHeight="300px" portalled={false}>
          <Box
            maxH="250px"
            overflowY="auto"
            css={{
              "&::-webkit-scrollbar": { display: "none" },
              msOverflowStyle: "none",
              scrollbarWidth: "none",
            }}
          >
            {participantsLeft.map((item) => (
              <Select.Item key={item.value} item={item}>
                <VStack align="start">
                  <HStack>
                    {item.value.startsWith("user-") ? (
                      <ParticipantAvatar name={item.label} />
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
          {participantsLeft.length === 0 && (
            <Text padding={3} textAlign="center">
              No options
            </Text>
          )}
        </Select.Content>
      </Select.Root>
      <Spacer />
    </VStack>
  );
}
