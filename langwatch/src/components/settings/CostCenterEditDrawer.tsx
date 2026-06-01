import { Button, Field, HStack, Input, Spacer, VStack } from "@chakra-ui/react";
import { useEffect, useState } from "react";

import { Drawer } from "~/components/ui/drawer";
import { toaster } from "~/components/ui/toaster";
import { api } from "~/utils/api";

type CostCenterRow = { id: string; name: string };

export function CostCenterEditDrawer({
  organizationId,
  costCenter,
  onOpenChange,
  onSaved,
}: {
  organizationId: string;
  costCenter: CostCenterRow | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");

  useEffect(() => {
    if (costCenter) {
      setName(costCenter.name);
    }
  }, [costCenter]);

  const renameMutation = api.costCenters.rename.useMutation();

  const close = () => {
    if (renameMutation.isLoading) return;
    onOpenChange(false);
  };

  const submit = async () => {
    if (!costCenter) return;
    const trimmed = name.trim();
    if (!trimmed) {
      toaster.create({ title: "Name is required", type: "error" });
      return;
    }
    try {
      await renameMutation.mutateAsync({
        organizationId,
        id: costCenter.id,
        name: trimmed,
      });
      toaster.create({ title: "Cost center renamed", type: "success" });
      onSaved();
      onOpenChange(false);
    } catch (error) {
      toaster.create({
        title: error instanceof Error ? error.message : "Rename failed",
        type: "error",
      });
    }
  };

  return (
    <Drawer.Root
      open={!!costCenter}
      onOpenChange={() => close()}
      placement="end"
      size="md"
    >
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <Drawer.Title>Edit cost center</Drawer.Title>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          <VStack align="stretch" gap={4}>
            <Field.Root required>
              <Field.Label>Name</Field.Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && name.trim()) {
                    void submit();
                  }
                }}
                autoFocus
              />
            </Field.Root>
          </VStack>
        </Drawer.Body>
        <Drawer.Footer>
          <HStack width="full">
            <Spacer />
            <Button
              variant="ghost"
              onClick={close}
              disabled={renameMutation.isLoading}
            >
              Cancel
            </Button>
            <Button
              colorPalette="orange"
              onClick={() => void submit()}
              loading={renameMutation.isLoading}
              disabled={!name.trim() || name.trim() === costCenter?.name}
            >
              Save changes
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
