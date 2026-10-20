// Writing a role with the answer beside it: what it should reach on the left, what
// that adds up to on the right. Creating and editing are one screen (main's RoleDialog).

import { type AuthzPermission, isRegistryPermission } from "@langwatch/authorization";
import { Card } from "@langwatch/design-system/card";
import { Dialog } from "@langwatch/design-system/dialog";
import {
  Box,
  Field,
  Grid,
  Input,
  Text,
  Textarea,
  VStack,
} from "@langwatch/design-system/primitives";
import type { ScopeTriadEntry } from "@langwatch/design-system/scope-chip-picker";
import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  type Control,
  type UseFormRegister,
  useForm,
  useFormState,
  useWatch,
} from "react-hook-form";

import { authzApi } from "../../behavior/authz-api.ts";
import { useAuthzHost } from "../../model/authz-host.ts";
import { RoleEffectPreview } from "../blocks/role-effect-preview.tsx";
import { RolePermissionComposer } from "../blocks/role-permission-composer.tsx";

const ROLE_FORM_ID = "role-form";

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
    <Dialog
      open={props.open}
      onClose={form.close}
      title={props.editing ? "Edit role" : "New role"}
      size="xl"
      primaryAction={{
        label: props.editing ? "Save role" : "Create role",
        type: "submit",
        form: ROLE_FORM_ID,
        loading: form.saving,
      }}
    >
      <RoleFormBody organizationId={props.organizationId} {...form} />
    </Dialog>
  );
}

function useRoleForm({ open, organizationId, editing, onClose }: RoleDialogProps) {
  const [previewScope, setPreviewScope] = useState<ScopeTriadEntry[]>([
    { scopeType: "ORGANIZATION", scopeId: organizationId },
  ]);
  const { control, register, handleSubmit, reset, setFocus, setValue } = useForm<RoleFormValues>({
    defaultValues: { name: "", description: "", permissions: [] },
  });
  const permissions = useWatch({ control, name: "permissions" }) ?? [];
  const [attempted, setAttempted] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Mounted once and reused, so each opening refills it from the role in hand.
  useEffect(() => {
    if (!open) return;
    reset(
      {
        name: editing?.name ?? "",
        description: editing?.description ?? "",
        permissions: (editing?.permissions ?? []).filter(isRegistryPermission),
      },
      // The compiled form never re-calls register(), so the reset keeps its fields (WEB-5030).
      { keepFieldsRef: true },
    );
    setPreviewScope([{ scopeType: "ORGANIZATION", scopeId: organizationId }]);
  }, [open, editing, organizationId, reset]);

  const close = () => {
    setAttempted(false);
    onClose();
  };
  const { saving, save } = useRoleMutations({ organizationId, editing, onClose: close });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setAttempted(true);
    void handleSubmit(
      (values) => {
        if (values.permissions.length === 0) {
          searchRef.current?.focus();
          return;
        }
        return save(values);
      },
      () => setFocus("name"),
    )(event);
  };

  return {
    attempted,
    close,
    control,
    permissions,
    searchRef,
    previewScope,
    register,
    saving,
    setPreviewScope,
    setPermissions: (next: AuthzPermission[]) =>
      setValue("permissions", next, { shouldDirty: true }),
    submit,
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
  attempted,
  searchRef,
  control,
  permissions,
  previewScope,
  register,
  setPreviewScope,
  setPermissions,
  submit,
}: { organizationId: string } & ReturnType<typeof useRoleForm>) {
  const structure = useAuthzHost().organizationStructure();

  return (
    <form id={ROLE_FORM_ID} onSubmit={submit}>
      <Grid templateColumns={{ base: "1fr", lg: "1.4fr 1fr" }} gap={8} alignItems="start">
        <VStack align="stretch" gap={5}>
          <RoleIdentityFields register={register} control={control} />

          <Box>
            <Text fontSize="sm" fontWeight="semibold">
              What it can reach
            </Text>
            <Text fontSize="xs" color="fg.muted">
              Read means look and never change. Full access means create, change and delete as well.
            </Text>
          </Box>

          {attempted && permissions.length === 0 && (
            <Text role="alert" fontSize="xs" color="fg.error">
              Choose at least one permission before saving.
            </Text>
          )}

          <RolePermissionComposer
            selected={permissions}
            onChange={setPermissions}
            searchRef={searchRef}
          />
        </VStack>

        <Box position={{ base: "static", lg: "sticky" }} top={0}>
          <Card variant="nested">
            <RoleEffectPreview
              permissions={permissions}
              previewScope={previewScope}
              onPreviewScopeChange={setPreviewScope}
              organizationId={organizationId}
              organizationName={structure.organizationName}
              availableTeams={structure.teams}
              availableProjects={structure.projects}
            />
          </Card>
        </Box>
      </Grid>
    </form>
  );
}

/** What the role is called, and who it is for. */
function RoleIdentityFields({
  register,
  control,
}: {
  register: UseFormRegister<RoleFormValues>;
  control: Control<RoleFormValues>;
}) {
  // A subscription here, so a refused submit re-renders the field as invalid (as WEB-5602).
  const { errors } = useFormState({ control, name: "name" });
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
