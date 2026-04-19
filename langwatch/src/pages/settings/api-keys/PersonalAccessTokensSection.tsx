import {
  Badge,
  Box,
  Button,
  Card,
  HStack,
  Spacer,
  Table,
  Text,
  VStack,
  useDisclosure,
} from "@chakra-ui/react";
import { Key, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toaster } from "../../../components/ui/toaster";
import { usePublicEnv } from "../../../hooks/usePublicEnv";
import { useRequiredSession } from "../../../hooks/useRequiredSession";
import { api } from "../../../utils/api";
import { CreatePatDrawer, type CreatePatInput } from "./CreatePatDrawer";
import { RevokeConfirmDialog } from "./RevokeConfirmDialog";
import { TokenCreatedDialog } from "./TokenCreatedDialog";
import { roleSummary } from "./utils";

/**
 * Lists a user's active PATs for the current organization and orchestrates
 * the create / reveal / revoke flows. All transient UI state (which dialog
 * is open, the one-time token value, the pending revoke target) lives here
 * so the extracted child components stay stateless where possible.
 */
export function PersonalAccessTokensSection({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId?: string;
}) {
  useRequiredSession();
  const publicEnv = usePublicEnv();
  const endpoint = publicEnv.data?.BASE_HOST ?? "https://app.langwatch.ai";
  const pats = api.personalAccessToken.list.useQuery({ organizationId });
  const myBindings = api.personalAccessToken.myBindings.useQuery({
    organizationId,
  });
  const createMutation = api.personalAccessToken.create.useMutation();
  const revokeMutation = api.personalAccessToken.revoke.useMutation();
  const queryClient = api.useContext();

  const {
    open: isCreateOpen,
    onOpen: onCreateOpen,
    onClose: onCreateClose,
  } = useDisclosure();

  const [newToken, setNewToken] = useState<string | null>(null);
  const [patToRevoke, setPatToRevoke] = useState<string | null>(null);

  const handleCreate = (input: CreatePatInput) => {
    // Mirror the caller's own RoleBindings onto the PAT. A future
    // "Advanced" UI will let users narrow this down per-scope/role.
    const bindings = (myBindings.data ?? []).map((b) => ({
      role: b.role,
      customRoleId: b.customRoleId,
      scopeType: b.scopeType,
      scopeId: b.scopeId,
    }));

    if (bindings.length === 0) {
      toaster.create({
        title: "No permissions to grant",
        description:
          "You have no role bindings in this organization, so there is nothing to grant to a token.",
        type: "error",
        duration: 5000,
        meta: { closable: true },
      });
      return;
    }

    createMutation.mutate(
      {
        organizationId,
        name: input.name,
        description: input.description.trim()
          ? input.description.trim()
          : undefined,
        expiresAt: input.expiresAt,
        bindings,
      },
      {
        onSuccess: (result) => {
          setNewToken(result.token);
          void queryClient.personalAccessToken.list.invalidate();
        },
        onError: (error) => {
          toaster.create({
            title: "Failed to create token",
            description: error.message,
            type: "error",
            duration: 5000,
            meta: { closable: true },
          });
        },
      },
    );
  };

  const handleRevoke = (patId: string) => {
    revokeMutation.mutate(
      { organizationId, patId },
      {
        onSuccess: () => {
          setPatToRevoke(null);
          toaster.create({
            title: "Token revoked",
            type: "success",
            duration: 3000,
            meta: { closable: true },
          });
          void queryClient.personalAccessToken.list.invalidate();
        },
        onError: (error) => {
          toaster.create({
            title: "Failed to revoke token",
            description: error.message,
            type: "error",
            duration: 5000,
            meta: { closable: true },
          });
        },
      },
    );
  };

  const activePats = useMemo(
    () => pats.data?.filter((p) => !p.revokedAt) ?? [],
    [pats.data],
  );

  return (
    <>
      <VStack gap={4} width="full" align="start">
        <HStack width="full">
          <Text fontSize="sm" color="fg.muted">
            User-scoped tokens that authenticate API requests on your behalf.
            Shown once at creation — copy it immediately.
          </Text>
          <Spacer />
          <Button size="sm" onClick={onCreateOpen}>
            <Plus size={16} />
            Create Token
          </Button>
        </HStack>

        <Card.Root width="full" overflow="hidden">
          <Card.Body paddingY={0} paddingX={0}>
            <Table.Root variant="line" size="md" width="full">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>Name</Table.ColumnHeader>
                  <Table.ColumnHeader>Permissions</Table.ColumnHeader>
                  <Table.ColumnHeader>Expires</Table.ColumnHeader>
                  <Table.ColumnHeader>Created</Table.ColumnHeader>
                  <Table.ColumnHeader>Last Used</Table.ColumnHeader>
                  <Table.ColumnHeader width="80px"></Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {activePats.length === 0 && (
                  <Table.Row>
                    <Table.Cell colSpan={6}>
                      <Text color="fg.muted" textAlign="center" paddingY={4}>
                        No active tokens. Create one to get started.
                      </Text>
                    </Table.Cell>
                  </Table.Row>
                )}
                {activePats.map((pat) => (
                  <Table.Row key={pat.id}>
                    <Table.Cell>
                      <HStack align="start">
                        <Box paddingTop={1}>
                          <Key size={14} />
                        </Box>
                        <VStack align="start" gap={0}>
                          <Text>{pat.name}</Text>
                          {pat.description && (
                            <Text fontSize="xs" color="fg.muted">
                              {pat.description}
                            </Text>
                          )}
                        </VStack>
                      </HStack>
                    </Table.Cell>
                    <Table.Cell>
                      <Text fontSize="sm" color="fg.muted">
                        {roleSummary(pat.roleBindings)}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      {pat.expiresAt ? (
                        new Date(pat.expiresAt) < new Date() ? (
                          <Badge size="sm" colorPalette="red">
                            Expired
                          </Badge>
                        ) : (
                          new Date(pat.expiresAt).toLocaleDateString()
                        )
                      ) : (
                        <Badge size="sm" colorPalette="gray">
                          Never
                        </Badge>
                      )}
                    </Table.Cell>
                    <Table.Cell>
                      {new Date(pat.createdAt).toLocaleDateString()}
                    </Table.Cell>
                    <Table.Cell>
                      {pat.lastUsedAt ? (
                        new Date(pat.lastUsedAt).toLocaleDateString()
                      ) : (
                        <Badge size="sm" colorPalette="gray">
                          Never
                        </Badge>
                      )}
                    </Table.Cell>
                    <Table.Cell>
                      <Button
                        size="xs"
                        variant="ghost"
                        colorPalette="red"
                        aria-label={`Revoke token ${pat.name}`}
                        onClick={() => setPatToRevoke(pat.id)}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </Button>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </Card.Body>
        </Card.Root>
      </VStack>

      <CreatePatDrawer
        isOpen={isCreateOpen && !newToken}
        isCreating={createMutation.isLoading}
        myBindings={myBindings}
        onClose={onCreateClose}
        onCreate={handleCreate}
      />

      <TokenCreatedDialog
        newToken={newToken}
        projectId={projectId}
        endpoint={endpoint}
        onClose={() => {
          setNewToken(null);
          onCreateClose();
        }}
      />

      <RevokeConfirmDialog
        patId={patToRevoke}
        isRevoking={revokeMutation.isLoading}
        onCancel={() => setPatToRevoke(null)}
        onConfirm={handleRevoke}
      />
    </>
  );
}
