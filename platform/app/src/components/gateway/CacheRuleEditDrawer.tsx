import { Button, HStack, Spacer } from "@chakra-ui/react";
import { useEffect, useState } from "react";

import { Drawer } from "~/components/ui/drawer";
import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

import {
  CacheRuleForm,
  type CacheRuleFormComplaint,
  type CacheRuleFormState,
  emptyFormState,
  fromWire,
  toWire,
  validateForm,
} from "./cacheRule.form";

type Rule = {
  id: string;
  name: string;
  description: string | null;
  priority: number;
  enabled: boolean;
  matchers: unknown;
  action: unknown;
};

type Props = {
  rule: Rule | null;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
};

export function CacheRuleEditDrawer({ rule, onOpenChange, onSaved }: Props) {
  const { organization } = useOrganizationTeamProject();
  const utils = api.useUtils();

  const updateMutation = api.gatewayCacheRules.update.useMutation({
    onSuccess: async () => {
      if (organization?.id) {
        await utils.gatewayCacheRules.list.invalidate({
          organizationId: organization.id,
        });
      }
    },
  });

  const [state, setState] = useState<CacheRuleFormState>(emptyFormState());
  const [fieldComplaint, setFieldComplaint] = useState<CacheRuleFormComplaint | null>(
    null,
  );

  useEffect(() => {
    if (rule) {
      setFieldComplaint(null);
      setState(
        fromWire({
          name: rule.name,
          description: rule.description,
          priority: rule.priority,
          enabled: rule.enabled,
          matchers: rule.matchers,
          action: rule.action,
        }),
      );
    }
  }, [rule]);

  const handleClose = () => {
    if (updateMutation.isPending) return;
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!organization || !rule) return;
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
      await updateMutation.mutateAsync({
        organizationId: organization.id,
        id: rule.id,
        ...toWire(state),
      });
      onOpenChange(false);
      onSaved?.();
    } catch (e) {
      showErrorToast({
        error: e,
        fallbackTitle: "Couldn't save the cache rule",
      });
    }
  };

  return (
    <Drawer.Root
      open={!!rule}
      onOpenChange={() => handleClose()}
      placement="end"
      size="md"
    >
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <Drawer.Title>Edit cache rule</Drawer.Title>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          <CacheRuleForm
            state={state}
            onChange={(next) => {
              setState(next);
              setFieldComplaint(null);
            }}
            complaint={fieldComplaint}
          />
        </Drawer.Body>
        <Drawer.Footer>
          <HStack width="full">
            <Spacer />
            <Button
              variant="ghost"
              onClick={handleClose}
              disabled={updateMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              colorPalette="orange"
              onClick={handleSubmit}
              loading={updateMutation.isPending}
              disabled={!state.name.trim()}
            >
              Save changes
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
