// Writing a role with the answer beside it: what it should reach on the left, what
// that adds up to on the right. Creating and editing are one screen (main's RoleDialog).

import { Box, Button, Field, Grid, Input, Text, Textarea, VStack } from "@chakra-ui/react";
import { type AuthzPermission, isRegistryPermission } from "@langwatch/authorization";
import type { ScopeTriadEntry } from "@langwatch/authz-browser-kit";
import { Dialog } from "@langwatch/design-system/dialog";
import { useEffect, useState } from "react";
import { type FieldErrors, type UseFormRegister, useForm, useWatch } from "react-hook-form";

import { authzApi } from "../../behavior/authz-api.ts";
import { useAuthzHost } from "../../model/authz-host.ts";
import { RoleEffectPreview } from "../blocks/role-effect-preview.tsx";
import { RolePermissionComposer } from "../blocks/role-permission-composer.tsx";

type RoleFormValues = {
  name: string;
  description: string;
  permissions: AuthzPermission[];
};

/** The role being edited, or null when a new one is being written. */
export type EditedRole = {
  id: string;
  name: string;
  description: string | null;
  permissions: readonly string[];
};

type RoleDialogProps = {
  open: boolean;
  organizationId: string;
  editing: EditedRole | null;
  onClose: () => void;
};

export function RoleDialog(props: RoleDialogProps) {
  const form = useRoleForm(props);

  return (
    <Dialog.Root open={props.open} onOpenChange={({ open }) => !open && props.onClose()}>
      <Dialog.Content bg="bg" maxWidth="1040px" maxHeight="90vh" overflowY="auto">
        <Dialog.Header>
          <Dialog.Title>{props.editing ? "Edit role" : "New role"}</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <RoleFormBody organizationId={props.organizationId} {...form} />
        </Dialog.Body>
        <Dialog.Footer>
          {form.permissions.length === 0 && (
            <Text fontSize="xs" color="fg.muted" marginRight="auto">
              Choose at least one permission before saving.
            </Text>
          )}
          <Button variant="outline" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="role-form"
            colorPalette="orange"
            loading={form.saving}
            disabled={form.permissions.length === 0}
          >
            {props.editing ? "Save role" : "Create role"}
          </Button>
        </Dialog.Footer>
        <Dialog.CloseTrigger />
      </Dialog.Content>
    </Dialog.Root>
  );
}

function useRoleForm({ open, organizationId, editing, onClose }: RoleDialogProps) {
  const [previewScope, setPreviewScope] = useState<ScopeTriadEntry[]>([
    { scopeType: "ORGANIZATION", scopeId: organizationId },
  ]);
  const {
    control,
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<RoleFormValues>({ defaultValues: { name: "", description: "", permissions: [] } });
  const permissions = useWatch({ control, name: "permissions" }) ?? [];

  // Mounted once and reused, so each opening refills it from the role in hand.
  useEffect(() => {
    if (!open) return;
    reset({
      name: editing?.name ?? "",
      description: editing?.description ?? "",
      permissions: (editing?.permissions ?? []).filter(isRegistryPermission),
    });
    setPreviewScope([{ scopeType: "ORGANIZATION", scopeId: organizationId }]);
  }, [open, editing, organizationId, reset]);

  const { saving, save } = useRoleMutations({ organizationId, editing, onClose });

  return {
    errors,
    permissions,
    previewScope,
    register,
    saving,
    setPreviewScope,
    setPermissions: (next: AuthzPermission[]) =>
      setValue("permissions", next, { shouldDirty: true }),
    submit: handleSubmit(save),
  };
}

function useRoleMutations({
  organizationId,
  editing,
  onClose,
}: Pick<RoleDialogProps, "organizationId" | "editing" | "onClose">) {
  const host = useAuthzHost();
  const utils = authzApi.useUtils();
  const onSaved = (title: string) => {
    void utils.role.getAll.invalidate();
    void utils.authz.listManagedGrants.invalidate();
    host.succeeded({ title });
    onClose();
  };

  const createRole = authzApi.role.create.useMutation({
    onSuccess: () => onSaved("Role created"),
    onError: (error) => host.failed({ error, fallbackTitle: "Couldn't create this role" }),
  });
  const updateRole = authzApi.role.update.useMutation({
    onSuccess: () => onSaved("Role saved"),
    onError: (error) => host.failed({ error, fallbackTitle: "Couldn't save this role" }),
  });

  const save = async ({ name, description, permissions }: RoleFormValues) => {
    if (editing) {
      await updateRole.mutateAsync({ roleId: editing.id, name, description, permissions });
      return;
    }
    await createRole.mutateAsync({ organizationId, name, description, permissions });
  };

  return { saving: createRole.isPending || updateRole.isPending, save };
}

function RoleFormBody({
  organizationId,
  errors,
  permissions,
  previewScope,
  register,
  setPreviewScope,
  setPermissions,
  submit,
}: { organizationId: string } & ReturnType<typeof useRoleForm>) {
  const structure = useAuthzHost().organizationStructure();

  return (
    <form id="role-form" onSubmit={(event) => void submit(event)}>
      <Grid templateColumns={{ base: "1fr", lg: "1.4fr 1fr" }} gap={8} alignItems="start">
        <VStack align="stretch" gap={5}>
          <RoleIdentityFields register={register} errors={errors} />

          <Box>
            <Text fontSize="sm" fontWeight="semibold">
              What it can reach
            </Text>
            <Text fontSize="xs" color="fg.muted">
              Read means look and never change. Full access means create, change and delete as well.
            </Text>
          </Box>

          <RolePermissionComposer selected={permissions} onChange={setPermissions} />
        </VStack>

        <Box
          position={{ base: "static", lg: "sticky" }}
          top={0}
          borderWidth="1px"
          borderColor="border"
          borderRadius="md"
          padding={4}
          background="bg.subtle"
        >
          <RoleEffectPreview
            permissions={permissions}
            previewScope={previewScope}
            onPreviewScopeChange={setPreviewScope}
            organizationId={organizationId}
            organizationName={structure.organizationName}
            availableTeams={structure.teams}
            availableProjects={structure.projects}
          />
        </Box>
      </Grid>
    </form>
  );
}

/** What the role is called, and who it is for. */
function RoleIdentityFields({
  register,
  errors,
}: {
  register: UseFormRegister<RoleFormValues>;
  errors: FieldErrors<RoleFormValues>;
}) {
  return (
    <>
      <Field.Root invalid={!!errors.name}>
        <Field.Label>Name</Field.Label>
        <Input
          {...register("name", {
            required: "Give this role a name",
            maxLength: { value: 50, message: "Keep the name under 50 characters" },
          })}
          placeholder="Support analyst"
        />
        {errors.name && <Field.ErrorText>{errors.name.message}</Field.ErrorText>}
      </Field.Root>

      <Field.Root>
        <Field.Label>Description</Field.Label>
        <Field.HelperText>
          Who this role is for, so the next administrator knows whether to hand it out.
        </Field.HelperText>
        <Textarea
          {...register("description")}
          placeholder="Reads customer conversations while handling a ticket."
          rows={2}
        />
      </Field.Root>
    </>
  );
}
