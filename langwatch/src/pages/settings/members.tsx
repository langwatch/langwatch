import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  Button,
  Card,
  CardBody,
  FormErrorMessage,
  HStack,
  Heading,
  Input,
  LinkBox,
  Spacer,
  Spinner,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack,
  Text,
  useDisclosure,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
} from "@chakra-ui/react";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { useForm, useWatch, type SubmitHandler } from "react-hook-form";
import { useDebouncedCallback } from "use-debounce";
import SettingsLayout, {
  SettingsFormControl,
} from "../../components/SettingsLayout";
import type { OrganizationWithMembersAndTheirTeams } from "../../server/api/routers/organization";
import { api } from "../../utils/api";
import isEqual from "lodash.isequal";
import { ChevronRight, Mail, Plus } from "react-feather";
import NextLink from "next/link";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";

type TeamFormData = {
  name: string;
};

export default function Members() {
  const { organization } = useOrganizationTeamProject();

  const organizationWithMembers =
    api.organization.getOrganizationWithMembersAndTheirTeams.useQuery(
      {
        id: organization?.id ?? "",
      },
      { enabled: !!organization }
    );

  if (!organizationWithMembers.data) return <SettingsLayout />;

  return <MembersList organization={organizationWithMembers.data} />;
}

function MembersList({
  organization,
}: {
  organization: OrganizationWithMembersAndTheirTeams;
}) {
  const {
    isOpen: isAddMembersOpen,
    onOpen: onAddMembersOpen,
    onClose: onAddMembersClose,
  } = useDisclosure();

  return (
    <SettingsLayout>
      <VStack
        paddingX={4}
        paddingY={6}
        spacing={6}
        width="full"
        maxWidth="920px"
        align="start"
      >
        <HStack width="full" marginTop={2}>
          <Heading size="lg" as="h1">
            {organization.name} Members
          </Heading>
          <Spacer />
          <Button
            as="a"
            size="sm"
            colorScheme="orange"
            onClick={() => onAddMembersOpen()}
          >
            <HStack spacing={2}>
              <Plus size={20} />
              <Text>Add members</Text>
            </HStack>
          </Button>
        </HStack>
        <Card width="full">
          <CardBody width="full" paddingY={0} paddingX={0}>
            <Table variant="simple" width="full">
              <Thead>
                <Tr>
                  <Th>Name</Th>
                  <Th>Role</Th>
                  <Th>Teams</Th>
                </Tr>
              </Thead>
              <Tbody>
                {organization.members.map((member) => (
                  <LinkBox as="tr" key={member.userId}>
                    <Td>{member.user.name}</Td>
                    <Td>{member.role}</Td>
                    <Td>
                      {member.user.teamMemberships
                        .flatMap((tmember) => tmember.team)
                        .filter(
                          (tmember) => tmember.organizationId == organization.id
                        )
                        .map((tmember) => tmember.name)
                        .join(", ")}
                    </Td>
                  </LinkBox>
                ))}
              </Tbody>
            </Table>
          </CardBody>
        </Card>
      </VStack>

      <Modal isOpen={isAddMembersOpen} onClose={onAddMembersClose}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Add members</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {/* form with go here */}
          </ModalBody>

          <ModalFooter>
            <Button colorScheme="orange" size="md" onClick={onAddMembersClose}>
              <HStack>
                <Mail size={18} />
                <Text>Send invites</Text>
              </HStack>
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </SettingsLayout>
  );
}
