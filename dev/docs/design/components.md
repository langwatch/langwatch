# Component Preferences

This guide outlines which components to use for common UI patterns in LangWatch.

## Import Guidelines

Always import overlay components from `@langwatch/design-system`, not directly from Chakra UI. These components have the translucent styling pre-applied. Each imports from its own subpath.

### Local UI Components (use these)

```tsx
import { Drawer } from "@langwatch/design-system/drawer";
import { Dialog } from "@langwatch/design-system/dialog";
import { Popover } from "@langwatch/design-system/popover";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { Menu } from "@langwatch/design-system/menu";
import { Checkbox, CheckboxGroup } from "@langwatch/design-system/checkbox";
import { Radio, RadioGroup } from "@langwatch/design-system/radio";
import { Switch } from "@langwatch/design-system/switch";
import { InputGroup } from "@langwatch/design-system/input-group";
```

### Chakra UI Direct Imports

```tsx
import {
  Alert,
  Avatar,
  Button,
  Card,
  Field,
  Table,
  Input,
  Select,
  NativeSelect,
  Tabs,
  Textarea,
  Separator,
  useDisclosure,
  HStack,
  VStack,
  Box,
  Text,
  Heading,
} from "@chakra-ui/react";
```

## Drawer vs Dialog

### Use Drawer for:

| Use Case             | Example                  |
| -------------------- | ------------------------ |
| Resource creation    | "New Prompt" form        |
| Resource editing     | Editing trigger settings |
| Resource selection   | Selecting a dataset      |
| Configuration panels | LLM model settings       |
| Detail views         | Trace details            |
| Multi-step forms     | Batch evaluation setup   |

### Use Dialog for:

| Use Case       | Example                    |
| -------------- | -------------------------- |
| Confirmations  | "Delete this item?"        |
| Alerts         | Error messages             |
| Simple choices | "Save or discard changes?" |

### Drawer Anatomy

```tsx
<Drawer.Root open={isOpen} onOpenChange={({ open }) => setOpen(open)} placement="end" size="lg">
  <Drawer.Backdrop />
  <Drawer.Content>
    <Drawer.CloseTrigger />
    <Drawer.Header>
      <Drawer.Title>Drawer Title</Drawer.Title>
    </Drawer.Header>
    <Drawer.Body>{/* Main content */}</Drawer.Body>
    <Drawer.Footer>
      <Button variant="outline" onClick={onClose}>
        Cancel
      </Button>
      <Button colorPalette="blue" onClick={onSave}>
        Save
      </Button>
    </Drawer.Footer>
  </Drawer.Content>
</Drawer.Root>
```

### Dialog Anatomy

```tsx
<Dialog.Root open={isOpen} onOpenChange={({ open }) => setOpen(open)}>
  <Dialog.Content>
    <Dialog.CloseTrigger />
    <Dialog.Header>
      <Dialog.Title>Confirm Action</Dialog.Title>
    </Dialog.Header>
    <Dialog.Body>Are you sure you want to proceed?</Dialog.Body>
    <Dialog.Footer>
      <Button variant="outline" onClick={onClose}>
        Cancel
      </Button>
      <Button colorPalette="red" onClick={onConfirm}>
        Delete
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
```

## Drawer Navigation (useDrawer Hook)

LangWatch uses a centralized drawer system with URL-based state management. Drawers can navigate to other drawers while maintaining back button functionality.

### Architecture

The system consists of two parts:

1. **`CurrentDrawer`** - A global component, mounted once near the app root, that reads URL params and renders the appropriate drawer
2. **`useDrawer`** - A hook (from `@langwatch/ui-drawer`) for opening/closing drawers and managing navigation

**Important:** Don't render drawers explicitly in pages - `CurrentDrawer` handles rendering automatically based on URL state. This ensures:

- Browser back/forward buttons work naturally
- URLs are shareable (drawer state is in the URL)
- No duplicate drawer rendering

### Basic Usage

```tsx
import { useDrawer } from "@langwatch/ui-drawer";

function MyComponent() {
  const { openDrawer, closeDrawer, canGoBack, goBack, currentDrawer } = useDrawer();

  // Open a drawer
  openDrawer("promptEditor", { promptId: "abc123" });

  // Navigate to another drawer (adds to stack)
  openDrawer("promptList");

  // Go back to previous drawer
  goBack();

  // Close drawer entirely (clears stack)
  closeDrawer();
}
```

### Hook API

| Function/Property                    | Description                                       |
| ------------------------------------ | ------------------------------------------------- |
| `openDrawer(type, props?, options?)` | Open a drawer with optional props                 |
| `closeDrawer()`                      | Close drawer and clear navigation stack           |
| `goBack()`                           | Return to previous drawer in stack                |
| `canGoBack`                          | Boolean - true if there's history to go back to   |
| `currentDrawer`                      | Currently open drawer type                        |
| `setFlowCallbacks(type, callbacks)`  | Register callbacks that persist across navigation |
| `getFlowCallbacks(type)`             | Retrieve persisted callbacks                      |

### Options

```tsx
// Replace current drawer instead of pushing to stack
openDrawer("promptEditor", { promptId: "abc" }, { replace: true });

// Reset stack (no back button will show)
openDrawer("targetTypeSelector", {}, { resetStack: true });
```

### Flow Callbacks

For callbacks that need to persist across drawer navigation:

```tsx
// In parent component - set callbacks before opening first drawer
const { setFlowCallbacks, openDrawer } = useDrawer();

const handleSelectPrompt = (prompt) => {
  // Handle selection
};

setFlowCallbacks("promptList", { onSelect: handleSelectPrompt });
openDrawer("targetTypeSelector");

// In PromptListDrawer - retrieve the callback
const { getFlowCallbacks } = useDrawer();
const callbacks = getFlowCallbacks("promptList");
callbacks?.onSelect?.(selectedPrompt);
```

### Registered Drawers

A drawer is registered by the feature that owns it, not in one shared file. Each feature's `web` package exports a `UiDrawerRegistry` (built with `lazyDrawer` from `@langwatch/ui-drawer`), and `apps/ui/src/features/installed-ui-drawers.ts` composes every feature's registry into the one the application serves. See `dev/docs/best_practices/drawers.md` ("Adding a new drawer") for the full walkthrough, including the `withHost` wrapping step that happens in `apps/ui`'s own `*-drawers.tsx` files.

## Page Layout Components

Use `PageLayout` for consistent page structure.

```tsx
import { PageLayout } from "@langwatch/design-system/page-layout";
```

### Available Components

| Component                 | Purpose                                     |
| ------------------------- | ------------------------------------------- |
| `PageLayout.Container`    | Main page wrapper with responsive max-width |
| `PageLayout.Header`       | Fixed-height header with border             |
| `PageLayout.Heading`      | Page title (h1)                             |
| `PageLayout.HeaderButton` | Styled button for header actions            |
| `PageLayout.Content`      | Card wrapper for page content               |

## Button Variants

```tsx
// Primary actions
<Button colorPalette="blue">Save</Button>

// Secondary actions
<Button variant="outline">Cancel</Button>

// Destructive actions
<Button colorPalette="red">Delete</Button>

// Ghost buttons (subtle)
<Button variant="ghost">View Details</Button>

// Header buttons
<PageLayout.HeaderButton>
  <LuPlus /> Add New
</PageLayout.HeaderButton>
```

## Form Components

### Input with Field

```tsx
<Field label="Email" required errorText={errors.email}>
  <Input placeholder="Enter email" borderRadius="lg" />
</Field>
```

### Select

```tsx
<NativeSelect.Root size="sm">
  <NativeSelect.Field onChange={handleChange}>
    <option value="option1">Option 1</option>
    <option value="option2">Option 2</option>
  </NativeSelect.Field>
  <NativeSelect.Indicator />
</NativeSelect.Root>
```

### Checkbox

```tsx
import { Checkbox } from "@langwatch/design-system/checkbox";

<Checkbox checked={isChecked} onCheckedChange={({ checked }) => setChecked(checked)}>
  Enable feature
</Checkbox>;
```

## Icons

Use lucide-react for all icons:

```tsx
import { Plus, Trash, Pencil, Check, X } from "lucide-react";

<Button>
  <Plus /> Add Item
</Button>;
```

## Tooltip

```tsx
import { Tooltip } from "@langwatch/design-system/tooltip";

<Tooltip content="Helpful description" positioning={{ placement: "top" }} showArrow>
  <Button>Hover me</Button>
</Tooltip>;
```

## Menu

```tsx
import { Menu } from "@langwatch/design-system/menu";

<Menu.Root>
  <Menu.Trigger asChild>
    <Button variant="ghost">
      <LuMoreVertical />
    </Button>
  </Menu.Trigger>
  <Menu.Content>
    <Menu.Item value="edit">Edit</Menu.Item>
    <Menu.Item value="delete">Delete</Menu.Item>
  </Menu.Content>
</Menu.Root>;
```

## Spacing Reference

| Token | Value | Use Case        |
| ----- | ----- | --------------- |
| `1`   | 4px   | Tight spacing   |
| `2`   | 8px   | Element margin  |
| `3`   | 12px  | Small gaps      |
| `4`   | 16px  | Standard gaps   |
| `6`   | 24px  | Section padding |
| `8`   | 32px  | Large sections  |
