import { Button, HStack, Spacer } from "@chakra-ui/react";
import { X } from "lucide-react";
import { useEffect, useState } from "react";

import { Drawer } from "~/components/ui/drawer";
import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

import {
  CacheRuleForm,
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
  const utils = api.useContext();

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

  useEffect(() => {
    if (rule) {
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
    const error = validateForm(state);
    if (error) {
      toaster.create({ title: error, type: "error" });
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
      toaster.create({
        title: e instanceof Error ? e.message : "Failed to save cache rule",
        type: "error",
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
      <Drawer.Content>
        <Drawer.Header>
          <HStack width="full">
            <Drawer.Title>Edit cache rule</Drawer.Title>
            <Spacer />
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClose}
              aria-label="Close"
              disabled={updateMutation.isPending}
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
