import { Button, HStack, Spacer } from "@chakra-ui/react";
import { X } from "lucide-react";
import { useState } from "react";

import { Drawer } from "~/components/ui/drawer";
import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

import { CacheRuleForm, type CacheRuleFormState, emptyFormState, validateForm, toWire } from "./cacheRule.form";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
};

export function CacheRuleCreateDrawer({ open, onOpenChange, onCreated }: Props) {
  const { organization } = useOrganizationTeamProject();
  const utils = api.useContext();

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

  const handleClose = () => {
    if (createMutation.isPending) return;
    setState(emptyFormState());
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!organization) return;
    const error = validateForm(state);
    if (error) {
      toaster.create({ title: error, type: "error" });
      return;
    }
    try {
      await createMutation.mutateAsync({
        organizationId: organization.id,
        ...toWire(state),
      });
      setState(emptyFormState());
      onOpenChange(false);
      onCreated?.();
    } catch (e) {
      toaster.create({
        title: e instanceof Error ? e.message : "Failed to create cache rule",
        type: "error",
      });
    }
  };

  return (
    <Drawer.Root
      open={open}
      onOpenChange={() => handleClose()}
      placement="end"
      size="md"
    >
      <Drawer.Content>
        <Drawer.Header>
          <HStack width="full">
            <Drawer.Title>New cache rule</Drawer.Title>
            <Spacer />
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClose}
              aria-label="Close"
              disabled={createMutation.isPending}
            >
              <X size={16} />
            </Button>
          </HStack>
        </Drawer.Header>
        <Drawer.Body>
          <CacheRuleForm state={state} onChange={setState} />
        </Drawer.Body>
        <Drawer.Footer>
          <HStack width="full">
            <Spacer />
            <Button
              variant="ghost"
              onClick={handleClose}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              colorPalette="orange"
              onClick={handleSubmit}
              loading={createMutation.isPending}
              disabled={!state.name.trim()}
            >
              Create rule
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
