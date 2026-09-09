import { Button, Field, HStack, Input, Spacer, VStack } from "@chakra-ui/react";
import { useForm } from "react-hook-form";

import { PermissionRequiredNotice } from "~/components/PermissionRequiredNotice";
import { Drawer } from "~/components/ui/drawer";
import { toaster } from "~/components/ui/toaster";
import {
  applyHandledErrorToForm,
  FormServerError,
  showErrorToast,
} from "~/features/errors";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

/**
 * Creating a department, as the section's ordinary right-side drawer.
 *
 * A drawer rather than a modal because that is the one create surface this app
 * has: URL-routed, so `?drawer.open=addDepartment` reopens it from a paste, so
 * browser back closes it, and so another page can reach it by address alone
 * (`dev/docs/best_practices/drawers.md`). It is registered in `drawerRegistry`
 * as `addDepartment` and mounted by `CurrentDrawer`, never by the page that
 * opens it.
 *
 * ONE FIELD, and that is the whole model. `model Department` stores an id, the
 * organization it belongs to, a name, its two timestamps and the moment it was
 * archived — nothing a person sets at creation beyond the name. There is no
 * description, no parent department, no cost centre and no owner to collect, so
 * the drawer collects a name and says what the name is for.
 *
 * The reader who lands here without `governance:manage` gets the notice rather
 * than a form: the mutation is gated server-side, and offering a form that can
 * only be refused teaches nothing.
 *
 * Spec: specs/ai-governance/dashboard/people-tabs.feature
 */
export function AddDepartmentDrawer({ open = true }: { open?: boolean }) {
  const { organization, hasAnyPermission } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });
  const organizationId = organization?.id ?? "";
  const canManage = hasAnyPermission("governance:manage");

  const { closeDrawer } = useDrawer();
  const utils = api.useUtils();

  const form = useForm<{ name: string }>({ defaultValues: { name: "" } });
  const {
    formState: { errors },
    handleSubmit,
    register,
  } = form;

  const createMutation = api.departments.create.useMutation({
    onSuccess: async () => {
      toaster.create({ title: "Department created", type: "success" });
      closeDrawer();
      await utils.departments.list.invalidate({ organizationId });
    },
    // A rejected name belongs beside the field the reader is looking at, so the
    // form takes the validation failure first and only what it cannot show
    // falls through to a toast.
    onError: (error) => {
      if (applyHandledErrorToForm({ error, form, hasFormErrorSlot: true }))
        return;
      showErrorToast({ error, fallbackTitle: "Couldn't create department" });
    },
  });

  const submit = handleSubmit(({ name }) => {
    createMutation.mutate({ organizationId, name: name.trim() });
  });

  return (
    <Drawer.Root
      open={open}
      placement="end"
      size="md"
      onOpenChange={({ open: isOpen }) => {
        if (!isOpen && !createMutation.isPending) closeDrawer();
      }}
    >
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <Drawer.Title>Add department</Drawer.Title>
          {/* No `onClick` of its own. The trigger closes the drawer, which
              fires `onOpenChange` above, and wiring `closeDrawer` here as well
              called it twice for one dismissal. `closeDrawer` pushes a history
              entry, so the second call left a duplicate one: a reader who
              closed the drawer and pressed Back saw nothing happen, and on the
              second Back the drawer reopened. */}
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          {canManage ? (
            // eslint-disable-next-line @typescript-eslint/no-misused-promises
            <form onSubmit={submit} id="add-department-form">
              <VStack align="stretch" gap={4}>
                <FormServerError form={form} />
                <Field.Root invalid={!!errors.name} required>
                  <Field.Label>Department name</Field.Label>
                  <Input
                    autoFocus
                    aria-label="Department name"
                    placeholder="Engineering"
                    {...register("name", {
                      required: "Give the department a name.",
                      setValueAs: (value: string) =>
                        typeof value === "string" ? value.trim() : value,
                    })}
                  />
                  <Field.HelperText>
                    Spend rolls up by department, including personal AI use.
                  </Field.HelperText>
                  <Field.ErrorText>{errors.name?.message}</Field.ErrorText>
                </Field.Root>
              </VStack>
            </form>
          ) : (
            <PermissionRequiredNotice
              permission="governance:manage"
              detail="Creating a department needs this grant."
            />
          )}
        </Drawer.Body>
        {canManage && (
          <Drawer.Footer>
            <HStack width="full">
              <Spacer />
              <Button
                variant="ghost"
                onClick={closeDrawer}
                disabled={createMutation.isPending}
              >
                Cancel
              </Button>
              {/* Calls the submit handler rather than associating itself with
                  the form by id: the footer sits outside the body the form is
                  in, and a submit button reaching across that boundary is a
                  form association the drawer does not need. */}
              <Button
                colorPalette="orange"
                loading={createMutation.isPending}
                onClick={() => void submit()}
              >
                Create
              </Button>
            </HStack>
          </Drawer.Footer>
        )}
      </Drawer.Content>
    </Drawer.Root>
  );
}
