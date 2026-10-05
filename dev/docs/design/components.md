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

### Primitives and raw parts (`@langwatch/design-system/primitives`)

```tsx
import {
  Alert,
  Button,
  Card,
  Field,
  Table,
  Input,
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
} from "@langwatch/design-system/primitives";
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

## Drawer Navigation

Drawers are URL-routed singletons with a navigation stack (`dev/docs/ARCHITECTURE.md` §10). The open drawer and its params live in the URL (`?drawer.open=<name>`, `drawer.<key>`); the drawers beneath it live in `history.state`, so Back closes the top one and a reload restores the stack.

### Architecture

1. **`CurrentDrawer`** - mounted once by the shell; reads the URL and renders the open drawer.
2. **The declaration** - the owning module registers each drawer in its `<name>.web.ts` with `.drawer(Token, { load })`.
3. **`useDrawer`** - the host service (from `@langwatch/browser-host/drawer`) a screen uses to open, close and go back.

**Important:** Don't render drawers explicitly in pages - `CurrentDrawer` renders whatever the URL names. This keeps Back working, keeps drawer state shareable, and avoids duplicate mounts.

### Tokens, not bare names

A drawer another module opens is a typed token in its owner's contract (§10.1). Exemplar: dataset's contract (`modules/dataset/contract/src`) declares `SelectDatasetDrawerToken`, and `modules/dataset/browser/src/dataset.web.ts` registers it with `.drawer(SelectDatasetDrawerToken, { load })`. A drawer only its owner opens keeps its token in the owner's own `model/`. Opening a drawer by a bare name is a deleted spelling (§15); `navigateToDrawer` is the address door for code that only has an address.

### Basic Usage

```tsx
import { SelectDatasetDrawerToken } from "@langwatch/dataset-contract";
import { useDrawer } from "@langwatch/browser-host/drawer";

function MyComponent() {
  const { openDrawer, closeDrawer, canGoBack, goBack } = useDrawer();

  // Open the owner's drawer; props are typed by the token
  openDrawer(SelectDatasetDrawerToken, { onSelect: handleSelect, onClose: goBack });

  // Close drawer entirely (clears stack)
  closeDrawer();
}
```

### Hook API

| Function/Property                     | Description                                       |
| ------------------------------------- | ------------------------------------------------- |
| `openDrawer(Token, props?, options?)` | Open the token's drawer with typed props          |
| `closeDrawer()`                       | Close drawer and clear navigation stack           |
| `goBack()`                            | Return to previous drawer in stack                |
| `canGoBack`                           | Boolean - true if there's history to go back to   |
| `setFlowCallbacks(Token, callbacks)`  | Register callbacks that persist across navigation |
| `getFlowCallbacks(Token)`             | Retrieve persisted callbacks                      |

### Options

```tsx
// Replace current drawer instead of pushing to stack
openDrawer(SelectDatasetDrawerToken, {}, { replace: true });

// Reset stack (no back button will show)
openDrawer(SelectDatasetDrawerToken, {}, { resetStack: true });
```

### Flow Callbacks

A sub-flow passes `onClose` (usually `goBack`) rather than letting the target call `closeDrawer`, which clears the whole stack. For callbacks that must survive several drawer hops, register them against the token with `setFlowCallbacks(Token, callbacks)` and read them in the target with `getFlowCallbacks(Token)`.

### Registered Drawers

A drawer is registered by the module that owns it, in its declaration (`.drawer(Token, { load })`), never in one shared file. The browser runtime folds every installed declaration into one registry (`installedDrawerLoaders`) and refuses a name two modules claim. Drawer names are the wire: they ride shared links and REST `platformUrl` fields, so a renamed drawer is a regression.

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
