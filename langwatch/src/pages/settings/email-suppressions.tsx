import {
  Badge,
  Button,
  Card,
  EmptyState,
  Heading,
  HStack,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { MailX, Trash2 } from "lucide-react";
import SettingsLayout from "~/components/SettingsLayout";
import { toaster } from "~/components/ui/toaster";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

function EmailSuppressionsSettings() {
  const { project } = useOrganizationTeamProject();
  if (!project) return null;
  return <EmailSuppressionsPage projectId={project.id} />;
}

export default withPermissionGuard("triggers:view", {
  layoutComponent: SettingsLayout,
})(EmailSuppressionsSettings);

function EmailSuppressionsPage({ projectId }: { projectId: string }) {
  const utils = api.useUtils();
  const suppressions = api.emailSuppression.getAll.useQuery({ projectId });
  const remove = api.emailSuppression.remove.useMutation({
    onSuccess: async () => {
      await utils.emailSuppression.getAll.invalidate({ projectId });
      toaster.create({ title: "Suppression removed", type: "success" });
    },
    onError: () => {
      toaster.create({ title: "Could not remove suppression", type: "error" });
    },
  });

  return (
    <VStack align="stretch" gap={6} width="full" maxW="container.lg" padding={6}>
      <VStack align="start" gap={1}>
        <Heading size="lg">Email Suppressions</Heading>
        <Text color="fg.muted">
          Recipients who unsubscribed from this project&apos;s trigger
          notifications. Removing an entry resumes delivery to that address.
        </Text>
      </VStack>

      <Card.Root>
        <Card.Body>
          {suppressions.isLoading ? (
            <HStack justify="center" padding={8}>
              <Spinner />
            </HStack>
          ) : !suppressions.data || suppressions.data.length === 0 ? (
            <EmptyState.Root>
              <EmptyState.Content>
                <EmptyState.Indicator>
                  <MailX />
                </EmptyState.Indicator>
                <EmptyState.Title>No suppressions yet</EmptyState.Title>
                <EmptyState.Description>
                  When a recipient unsubscribes from a notification, they appear
                  here.
                </EmptyState.Description>
              </EmptyState.Content>
            </EmptyState.Root>
          ) : (
            <Table.Root size="sm">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>Email</Table.ColumnHeader>
                  <Table.ColumnHeader>Scope</Table.ColumnHeader>
                  <Table.ColumnHeader>Date</Table.ColumnHeader>
                  <Table.ColumnHeader />
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {suppressions.data.map((row) => (
                  <Table.Row key={row.id}>
                    <Table.Cell>{row.email}</Table.Cell>
                    <Table.Cell>
                      {row.triggerId == null ? (
                        <Badge colorPalette="red">All notifications</Badge>
                      ) : (
                        <Badge colorPalette="gray">
                          {row.triggerName ?? "Notification"}
                        </Badge>
                      )}
                    </Table.Cell>
                    <Table.Cell>
                      {new Date(row.createdAt).toLocaleDateString()}
                    </Table.Cell>
                    <Table.Cell textAlign="end">
                      <Button
                        size="xs"
                        variant="ghost"
                        loading={
                          remove.isPending && remove.variables?.id === row.id
                        }
                        onClick={() => remove.mutate({ projectId, id: row.id })}
                        aria-label="Remove suppression"
                      >
                        <Trash2 size={14} />
                      </Button>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          )}
        </Card.Body>
      </Card.Root>
    </VStack>
  );
}
