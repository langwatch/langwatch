import {
  Box,
  Button,
  Field,
  Grid,
  Input,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import type { AuthzPermission } from "@langwatch/authz";
import { useEffect, useState } from "react";
import type { FieldErrors, UseFormRegister } from "react-hook-form";
import { useForm, useWatch } from "react-hook-form";
import { showErrorToast } from "~/features/errors";
import { api } from "~/utils/api";
import type { ScopeTriadEntry } from "../settings/ScopeChipPicker";
import { Dialog } from "../ui/dialog";
import { toaster } from "../ui/toaster";
import { RoleEffectPreview } from "./RoleEffectPreview";
import { RolePermissionComposer } from "./RolePermissionComposer";

interface RoleFormValues {
  name: string;
  description: string;
  permissions: AuthzPermission[];
}

/**
 * Writing a role, with the answer on screen while you write it.
 *
 * Two halves, and they are two different questions. On the left, what this
 * role should reach, asked one part of the product at a time. On the right,
 * what that adds up to, in sentences, updating as the left-hand side changes —
 * because the thing being signed off is the sentence, not the checkbox.
 *
 * Creating and editing are the same screen. The only difference is which one
 * of two mutations it calls and what it says on the button, and pretending
 * otherwise would be two screens to keep in step.
 */
export function RoleDialog({
  open,
  organizationId,
  organizationName,
  editing,
  onClose,
}: {
  open: boolean;
  organizationId: string;
  organizationName?: string;
  editing: {
    id: string;
    name: string;
    description: string | null;
    permissions: string[];
  } | null;
  onClose: () => void;
}) {
  const apiContext = api.useUtils();
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
  } = useForm<RoleFormValues>({
    defaultValues: { name: "", description: "", permissions: [] },
  });

  const permissions = useWatch({ control, name: "permissions" }) ?? [];

  useEffect(() => {
    if (!open) return;
    reset({
      name: editing?.name ?? "",
      description: editing?.description ?? "",
      permissions: (editing?.permissions ?? []) as AuthzPermission[],
    });
    setPreviewScope([{ scopeType: "ORGANIZATION", scopeId: organizationId }]);
  }, [open, editing, organizationId, reset]);

  const teams = api.apiKey.orgTeams.useQuery(
    { organizationId },
    { enabled: open },
  );
  const projects = api.apiKey.orgProjects.useQuery(
    { organizationId },
    { enabled: open },
  );

  const onSaved = (title: string) => {
    void apiContext.role.getAll.invalidate();
    void apiContext.roleBinding.listForOrg.invalidate();
    toaster.create({ title, type: "success" });
    onClose();
  };

  const createRole = api.role.create.useMutation({
    onSuccess: () => onSaved("Role created"),
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't create this role" }),
  });
  const updateRole = api.role.update.useMutation({
    onSuccess: () => onSaved("Role saved"),
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't save this role" }),
  });

  const submit = handleSubmit(async (values) => {
    if (editing) {
      await updateRole.mutateAsync({
        roleId: editing.id,
        name: values.name,
        description: values.description,
        permissions: values.permissions,
      });
      return;
    }
    await createRole.mutateAsync({
      organizationId,
      name: values.name,
      description: values.description,
      permissions: values.permissions,
    });
  });

  const saving = createRole.isPending || updateRole.isPending;

  return (
    <Dialog.Root open={open} onOpenChange={({ open }) => !open && onClose()}>
      <Dialog.Content
        bg="bg"
        maxWidth="1040px"
        maxHeight="90vh"
        overflowY="auto"
      >
        <Dialog.Header>
          <Dialog.Title>{editing ? "Edit role" : "New role"}</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <form id="role-form" onSubmit={(event) => void submit(event)}>
            <Grid
              templateColumns={{ base: "1fr", lg: "1.4fr 1fr" }}
              gap={8}
              alignItems="start"
            >
              <VStack align="stretch" gap={5}>
                <RoleIdentityFields register={register} errors={errors} />

                <Box>
                  <Text fontSize="sm" fontWeight="semibold">
                    What it can reach
                  </Text>
                  <Text fontSize="xs" color="fg.muted">
                    Read means look and never change. Full access means create,
                    change and delete as well.
                  </Text>
                </Box>

                <RolePermissionComposer
                  selected={permissions}
                  onChange={(next) =>
                    setValue("permissions", next, { shouldDirty: true })
                  }
                />
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
                  organizationName={organizationName}
                  availableTeams={teams.data ?? []}
                  availableProjects={projects.data ?? []}
                />
              </Box>
            </Grid>
          </form>
        </Dialog.Body>
        <Dialog.Footer>
          {permissions.length === 0 && (
            <Text fontSize="xs" color="fg.muted" marginRight="auto">
              Choose at least one permission before saving.
            </Text>
          )}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="role-form"
            colorPalette="orange"
            loading={saving}
            disabled={permissions.length === 0}
          >
            {editing ? "Save role" : "Create role"}
          </Button>
        </Dialog.Footer>
        <Dialog.CloseTrigger />
      </Dialog.Content>
    </Dialog.Root>
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
            maxLength: {
              value: 50,
              message: "Keep the name under 50 characters",
            },
          })}
          placeholder="Support analyst"
          autoFocus
        />
        {errors.name && (
          <Field.ErrorText>{errors.name.message}</Field.ErrorText>
        )}
      </Field.Root>

      <Field.Root>
        <Field.Label>Description</Field.Label>
        <Field.HelperText>
          Who this role is for, so the next administrator knows whether to hand
          it out.
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
