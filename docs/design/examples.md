# Code Examples

Practical examples implementing LangWatch design guidelines.

## Page Layout

Standard page with header, actions, and content. Use `compactMenu` for content-heavy pages.

```tsx
import { HStack, Spacer, VStack } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { PageLayout } from "../../components/ui/layouts/PageLayout";

export function ExamplePage() {
  return (
    <DashboardLayout compactMenu={false}> {/* true for content-heavy pages */}
      <PageLayout.Container>
        <PageLayout.Header>
          <PageLayout.Heading>Page Title</PageLayout.Heading>
          <Spacer />
          <HStack gap={2}>
            <PageLayout.HeaderButton onClick={handleCreate}>
              <Plus /> Create New
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

## Drawer

Use for resource creation, editing, and selection flows.

```tsx
import { Button, Field, Input, useDisclosure, VStack } from "@chakra-ui/react";
import { Drawer } from "../../components/ui/drawer";

export function ResourceDrawer() {
  const { open, onOpen, onClose } = useDisclosure();

  return (
    <>
      <Button onClick={onOpen}>Open Drawer</Button>
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
            <Drawer.Title>Drawer Title</Drawer.Title>
          </Drawer.Header>
          <Drawer.Body>
            <VStack gap={4} align="stretch">
              <Field label="Name" required>
                <Input placeholder="Enter name" borderRadius="lg" />
              </Field>
            </VStack>
          </Drawer.Body>
          <Drawer.Footer>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button colorPalette="blue">Save</Button>
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer.Root>
    </>
  );
}
```

## Confirmation Dialog

Use for destructive action confirmations only.

```tsx
import { Button, useDisclosure, Text } from "@chakra-ui/react";
import { Dialog } from "../../components/ui/dialog";

export function DeleteConfirmDialog({ itemName, onConfirm }) {
  const { open, onOpen, onClose } = useDisclosure();

  return (
    <>
      <Button colorPalette="red" variant="outline" onClick={onOpen}>Delete</Button>
      <Dialog.Root open={open} onOpenChange={({ open }) => !open && onClose()}>
        <Dialog.Content>
          <Dialog.CloseTrigger />
          <Dialog.Header>
            <Dialog.Title>Delete {itemName}?</Dialog.Title>
          </Dialog.Header>
          <Dialog.Body>
            <Text>This action cannot be undone.</Text>
          </Dialog.Body>
          <Dialog.Footer>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button colorPalette="red" onClick={() => { onConfirm(); onClose(); }}>
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

For custom translucent containers (overlay components have this built-in).

```tsx
<Box
  background="white/75"
  backdropFilter="blur(8px)"
  borderRadius="lg"
  border="1px solid"
  borderColor="gray.200"
  padding={4}
>
  {children}
</Box>
```

## Menu

```tsx
import { Button } from "@chakra-ui/react";
import { MoreVertical, Pencil, Trash } from "lucide-react";
import { Menu } from "../../components/ui/menu";

<Menu.Root>
  <Menu.Trigger asChild>
    <Button variant="ghost" size="sm"><MoreVertical /></Button>
  </Menu.Trigger>
  <Menu.Content>
    <Menu.Item value="edit"><Pencil /> Edit</Menu.Item>
    <Menu.Item value="delete" color="red.500"><Trash /> Delete</Menu.Item>
  </Menu.Content>
</Menu.Root>
```

## Nested Drawer Navigation

Pattern for multi-step flows (e.g., type → list → editor). See `evaluations-v3` for the canonical implementation.

```tsx
import { Button, Heading, HStack } from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";
import { Drawer } from "../../components/ui/drawer";
import { useDrawer } from "~/hooks/useDrawer";

// Parent: Set callbacks and start flow
export function StartFlow() {
  const { openDrawer, setFlowCallbacks } = useDrawer();

  const handleStart = () => {
    setFlowCallbacks("itemSelector", {
      onSelect: (item) => console.log("Selected:", item),
    });
    openDrawer("categorySelector");
  };

  return <Button onClick={handleStart}>Select Item</Button>;
}

// Drawer with back button and navigation
export function CategoryDrawer() {
  const { openDrawer, closeDrawer, canGoBack, goBack } = useDrawer();

  return (
    <Drawer.Root open onOpenChange={({ open }) => !open && closeDrawer()}>
      <Drawer.Content>
        <Drawer.CloseTrigger />
        <Drawer.Header>
          <HStack gap={2}>
            {canGoBack && (
              <Button variant="ghost" size="sm" onClick={goBack} padding={1}>
                <ArrowLeft size={20} />
              </Button>
            )}
            <Heading>Select Category</Heading>
          </HStack>
        </Drawer.Header>
        <Drawer.Body>
          <Button onClick={() => openDrawer("itemSelector", { categoryId: "1" })}>
            Category 1
          </Button>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}

// Final drawer: retrieve callbacks
export function ItemDrawer() {
  const { closeDrawer, canGoBack, goBack, getFlowCallbacks } = useDrawer();
  const callbacks = getFlowCallbacks("itemSelector");

  const handleSelect = (item) => {
    callbacks?.onSelect?.(item);
    closeDrawer();
  };

  return (
    <Drawer.Root open onOpenChange={({ open }) => !open && closeDrawer()}>
      <Drawer.Content>
        <Drawer.Header>
          <HStack gap={2}>
            {canGoBack && (
              <Button variant="ghost" size="sm" onClick={goBack} padding={1}>
                <ArrowLeft size={20} />
              </Button>
            )}
            <Heading>Select Item</Heading>
          </HStack>
        </Drawer.Header>
        <Drawer.Body>{/* Item list */}</Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
```

**Key points:**
- `canGoBack` / `goBack()` - back button in drawer header
- `closeDrawer()` - close entire flow
- `setFlowCallbacks()` / `getFlowCallbacks()` - persist callbacks across navigation

## Popover

```tsx
import { Button, Text } from "@chakra-ui/react";
import { Info } from "lucide-react";
import { Popover } from "../../components/ui/popover";

<Popover.Root positioning={{ placement: "bottom-start" }}>
  <Popover.Trigger asChild>
    <Button variant="ghost" size="sm"><Info /></Button>
  </Popover.Trigger>
  <Popover.Content>
    <Popover.Arrow />
    <Popover.Header><Popover.Title>Title</Popover.Title></Popover.Header>
    <Popover.Body><Text fontSize="sm">Content</Text></Popover.Body>
  </Popover.Content>
</Popover.Root>
```
