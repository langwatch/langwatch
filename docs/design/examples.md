# Code Examples

Practical examples implementing LangWatch design guidelines.

## Complete Page Example

A standard page with header, actions, and content:

```tsx
import { HStack, Spacer, VStack } from "@chakra-ui/react";
import { LuPlus } from "react-icons/lu";
import { DashboardLayout } from "~/components/DashboardLayout";
import { PageLayout } from "../../components/ui/layouts/PageLayout";

export function ExamplePage() {
  return (
    <DashboardLayout>
      <PageLayout.Container>
        <PageLayout.Header>
          <PageLayout.Heading>Page Title</PageLayout.Heading>
          <Spacer />
          <HStack gap={2}>
            <PageLayout.HeaderButton onClick={handleCreate}>
              <LuPlus /> Create New
            </PageLayout.HeaderButton>
          </HStack>
        </PageLayout.Header>

        <VStack gap={4} padding={6} align="stretch">
          {/* Page content */}
        </VStack>
      </PageLayout.Container>
    </DashboardLayout>
  );
}
```

## Content-Heavy Page with Compact Menu

For pages where content needs maximum space:

```tsx
import { DashboardLayout } from "~/components/DashboardLayout";
import { PageLayout } from "../../components/ui/layouts/PageLayout";

export function PromptEditorPage() {
  return (
    <DashboardLayout compactMenu>
      <PageLayout.Container>
        <PageLayout.Header>
          <PageLayout.Heading>Prompt Editor</PageLayout.Heading>
          <Spacer />
          {/* Actions */}
        </PageLayout.Header>

        {/* Dense content area */}
      </PageLayout.Container>
    </DashboardLayout>
  );
}
```

## Resource Creation Drawer

Pattern for creating new resources:

```tsx
import { Button, Field, Input, useDisclosure, VStack } from "@chakra-ui/react";
import { useState } from "react";
import { Drawer } from "../../components/ui/drawer";

export function CreateResourceDrawer() {
  const { open, onOpen, onClose } = useDisclosure();
  const [name, setName] = useState("");

  const handleSave = async () => {
    // Save logic
    onClose();
  };

  return (
    <>
      <Button onClick={onOpen}>Create Resource</Button>

      <Drawer.Root
        open={open}
        onOpenChange={({ open }) => !open && onClose()}
        placement="end"
        size="lg"
      >
        <Drawer.Backdrop />
        <Drawer.Content>
          <Drawer.CloseTrigger />
          <Drawer.Header>
            <Drawer.Title>Create New Resource</Drawer.Title>
          </Drawer.Header>

          <Drawer.Body>
            <VStack gap={4} align="stretch">
              <Field label="Name" required>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter resource name"
                  borderRadius="lg"
                />
              </Field>
              {/* Additional fields */}
            </VStack>
          </Drawer.Body>

          <Drawer.Footer>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button colorPalette="blue" onClick={handleSave}>
              Create
            </Button>
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer.Root>
    </>
  );
}
```

## Resource Details Drawer

Pattern for viewing/editing existing resources:

```tsx
import { Button, useDisclosure, VStack, Text, HStack, Badge } from "@chakra-ui/react";
import { LuPencil, LuTrash } from "react-icons/lu";
import { Drawer } from "../../components/ui/drawer";

interface ResourceDetailsDrawerProps {
  resource: Resource;
  onEdit: () => void;
  onDelete: () => void;
}

export function ResourceDetailsDrawer({
  resource,
  onEdit,
  onDelete
}: ResourceDetailsDrawerProps) {
  const { open, onOpen, onClose } = useDisclosure();

  return (
    <>
      <Button variant="ghost" onClick={onOpen}>
        View Details
      </Button>

      <Drawer.Root
        open={open}
        onOpenChange={({ open }) => !open && onClose()}
        placement="end"
        size="md"
      >
        <Drawer.Backdrop />
        <Drawer.Content>
          <Drawer.CloseTrigger />
          <Drawer.Header>
            <Drawer.Title>{resource.name}</Drawer.Title>
          </Drawer.Header>

          <Drawer.Body>
            <VStack gap={4} align="stretch">
              <HStack justify="space-between">
                <Text color="gray.600">Status</Text>
                <Badge colorPalette="green">{resource.status}</Badge>
              </HStack>
              <HStack justify="space-between">
                <Text color="gray.600">Created</Text>
                <Text>{resource.createdAt}</Text>
              </HStack>
              {/* More details */}
            </VStack>
          </Drawer.Body>

          <Drawer.Footer>
            <Button variant="outline" onClick={onEdit}>
              <LuPencil /> Edit
            </Button>
            <Button colorPalette="red" variant="outline" onClick={onDelete}>
              <LuTrash /> Delete
            </Button>
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer.Root>
    </>
  );
}
```

## Confirmation Dialog

Pattern for destructive action confirmations:

```tsx
import { Button, useDisclosure, Text } from "@chakra-ui/react";
import { Dialog } from "../../components/ui/dialog";

interface DeleteConfirmDialogProps {
  itemName: string;
  onConfirm: () => void;
}

export function DeleteConfirmDialog({ itemName, onConfirm }: DeleteConfirmDialogProps) {
  const { open, onOpen, onClose } = useDisclosure();

  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  return (
    <>
      <Button colorPalette="red" variant="outline" onClick={onOpen}>
        Delete
      </Button>

      <Dialog.Root open={open} onOpenChange={({ open }) => !open && onClose()}>
        <Dialog.Content>
          <Dialog.CloseTrigger />
          <Dialog.Header>
            <Dialog.Title>Delete {itemName}?</Dialog.Title>
          </Dialog.Header>
          <Dialog.Body>
            <Text>
              This action cannot be undone. Are you sure you want to delete{" "}
              <strong>{itemName}</strong>?
            </Text>
          </Dialog.Body>
          <Dialog.Footer>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button colorPalette="red" onClick={handleConfirm}>
              Delete
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}
```

## Translucent Card

Custom card with the translucent effect (for special cases):

```tsx
import { Box, VStack, Text, Heading } from "@chakra-ui/react";

export function TranslucentCard({ title, children }) {
  return (
    <Box
      background="white/75"
      backdropFilter="blur(8px)"
      borderRadius="lg"
      border="1px solid"
      borderColor="gray.200"
      padding={4}
    >
      <VStack align="stretch" gap={3}>
        <Heading size="sm">{title}</Heading>
        {children}
      </VStack>
    </Box>
  );
}
```

## Menu with Actions

Context menu pattern:

```tsx
import { Button } from "@chakra-ui/react";
import { LuMoreVertical, LuPencil, LuCopy, LuTrash } from "react-icons/lu";
import { Menu } from "../../components/ui/menu";

export function ResourceActions({ onEdit, onDuplicate, onDelete }) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button variant="ghost" size="sm">
          <LuMoreVertical />
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.Item value="edit" onClick={onEdit}>
          <LuPencil /> Edit
        </Menu.Item>
        <Menu.Item value="duplicate" onClick={onDuplicate}>
          <LuCopy /> Duplicate
        </Menu.Item>
        <Menu.Item value="delete" onClick={onDelete} color="red.500">
          <LuTrash /> Delete
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}
```

## Form with Validation

Complete form pattern:

```tsx
import { Button, Field, Input, Textarea, VStack, HStack } from "@chakra-ui/react";
import { useState } from "react";

interface FormData {
  name: string;
  description: string;
}

interface FormErrors {
  name?: string;
  description?: string;
}

export function ResourceForm({ onSubmit, onCancel }) {
  const [formData, setFormData] = useState<FormData>({ name: "", description: "" });
  const [errors, setErrors] = useState<FormErrors>({});

  const validate = (): boolean => {
    const newErrors: FormErrors = {};
    if (!formData.name.trim()) {
      newErrors.name = "Name is required";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = () => {
    if (validate()) {
      onSubmit(formData);
    }
  };

  return (
    <VStack gap={4} align="stretch">
      <Field label="Name" required invalid={!!errors.name} errorText={errors.name}>
        <Input
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="Enter name"
          borderRadius="lg"
        />
      </Field>

      <Field label="Description">
        <Textarea
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          placeholder="Enter description"
          borderRadius="lg"
          rows={4}
        />
      </Field>

      <HStack justify="flex-end" gap={2}>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button colorPalette="blue" onClick={handleSubmit}>
          Save
        </Button>
      </HStack>
    </VStack>
  );
}
```

## Popover Pattern

For inline information or quick actions:

```tsx
import { Button, VStack, Text } from "@chakra-ui/react";
import { LuInfo } from "react-icons/lu";
import { Popover } from "../../components/ui/popover";

export function InfoPopover({ title, content }) {
  return (
    <Popover.Root positioning={{ placement: "bottom-start" }}>
      <Popover.Trigger asChild>
        <Button variant="ghost" size="sm">
          <LuInfo />
        </Button>
      </Popover.Trigger>
      <Popover.Content>
        <Popover.Arrow />
        <Popover.Header>
          <Popover.Title>{title}</Popover.Title>
        </Popover.Header>
        <Popover.Body>
          <Text fontSize="sm">{content}</Text>
        </Popover.Body>
      </Popover.Content>
    </Popover.Root>
  );
}
```
