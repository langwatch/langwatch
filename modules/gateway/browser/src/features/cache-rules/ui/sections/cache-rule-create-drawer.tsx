import { Drawer } from "@langwatch/design-system/drawer";
import { useState } from "react";

import { api } from "../../../../behavior/gateway-api.ts";
import { useGatewayToaster, useShowErrorToast } from "../../../../behavior/gateway-feedback.ts";
import { useOrganizationTeamProject } from "../../../../behavior/gateway-session.ts";
import {
  CacheRuleForm,
  type CacheRuleFormComplaint,
  type CacheRuleFormState,
  emptyFormState,
  toWire,
  validateForm,
} from "../blocks/cache-rule-form.tsx";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
};

export function CacheRuleCreateDrawer({ open, onOpenChange, onCreated }: Props) {
  const toaster = useGatewayToaster();
  const showErrorToast = useShowErrorToast();
  const { organization } = useOrganizationTeamProject();
  const utils = api.useUtils();

  const createMutation = api.gatewayCacheRules.create.useMutation({
    onSuccess: async () => {
      if (organization?.id) {
        await utils.gatewayCacheRules.list.invalidate({
          organizationId: organization.id,
        });
      }
    },
  });

  const [state, setState] = useState<CacheRuleFormState>(emptyFormState());
  const [fieldComplaint, setFieldComplaint] = useState<CacheRuleFormComplaint | null>(null);

  const handleClose = () => {
    if (createMutation.isPending) return;
    setState(emptyFormState());
    setFieldComplaint(null);
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!organization) return;
    // A complaint, not an error: `validateForm` is a pure local function
    // returning copy this form wrote about state it can see, and none of it
    // ever crossed a wire. That is exactly the case ADR-018 still lets
    // `toaster.create` handle — calling it an error would read as a caught
    // rejection, which has to go through `showErrorToast` instead.
    const complaint = validateForm(state);
    // One that names an input is marked on that input; one about the
    // relationship between several has no single home, so it keeps the toast.
    setFieldComplaint(complaint?.field ? complaint : null);
    if (complaint) {
      if (!complaint.field) {
        toaster.create({ title: complaint.message, type: "error" });
      }
      return;
    }
    try {
      await createMutation.mutateAsync({
        organizationId: organization.id,
        ...toWire(state),
      });
      setState(emptyFormState());
      setFieldComplaint(null);
      onOpenChange(false);
      onCreated?.();
    } catch (e) {
      showErrorToast({
        error: e,
        fallbackTitle: "Couldn't create the cache rule",
      });
    }
  };

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      title="New cache rule"
      size="md"
      busy={createMutation.isPending}
      footer={{
        cancel: { label: "Cancel", onClick: handleClose },
        primaryAction: {
          label: "Create rule",
          loading: createMutation.isPending,
          onClick: () => void handleSubmit(),
        },
      }}
    >
      <CacheRuleForm
        state={state}
        onChange={(next) => {
          setState(next);
          setFieldComplaint(null);
        }}
        complaint={fieldComplaint}
      />
    </Drawer>
  );
}
