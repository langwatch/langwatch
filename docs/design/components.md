# Component Preferences

This guide outlines which components to use for common UI patterns in LangWatch.

## Import Guidelines

Always import overlay components from the `components/ui/` directory, not directly from Chakra UI. These local components have the translucent styling pre-applied.

### Local UI Components (use these)

```tsx
import { Drawer } from "../../components/ui/drawer";
import { Dialog } from "../../components/ui/dialog";
import { Popover } from "../../components/ui/popover";
import { Tooltip } from "../../components/ui/tooltip";
import { Menu } from "../../components/ui/menu";
import { Checkbox, CheckboxGroup } from "../../components/ui/checkbox";
import { Radio, RadioGroup } from "../../components/ui/radio";
import { Switch } from "../../components/ui/switch";
import { InputGroup } from "../../components/ui/input-group";
import { Link } from "../../components/ui/link";
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

| Use Case | Example |
|----------|---------|
| Resource creation | "New Prompt" form |
| Resource editing | Editing trigger settings |
| Resource selection | Selecting a dataset |
| Configuration panels | LLM model settings |
| Detail views | Trace details |
| Multi-step forms | Batch evaluation setup |

### Use Dialog for:

| Use Case | Example |
|----------|---------|
| Confirmations | "Delete this item?" |
| Alerts | Error messages |
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
    <Drawer.Body>
      {/* Main content */}
    </Drawer.Body>
    <Drawer.Footer>
      <Button variant="outline" onClick={onClose}>Cancel</Button>
      <Button colorPalette="blue" onClick={onSave}>Save</Button>
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
    <Dialog.Body>
      Are you sure you want to proceed?
    </Dialog.Body>
    <Dialog.Footer>
      <Button variant="outline" onClick={onClose}>Cancel</Button>
      <Button colorPalette="red" onClick={onConfirm}>Delete</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
```

## Page Layout Components

Use `PageLayout` for consistent page structure.

```tsx
import { PageLayout } from "../../components/ui/layouts/PageLayout";
```

### Available Components

| Component | Purpose |
|-----------|---------|
| `PageLayout.Container` | Main page wrapper with responsive max-width |
| `PageLayout.Header` | Fixed-height header with border |
| `PageLayout.Heading` | Page title (h1) |
| `PageLayout.HeaderButton` | Styled button for header actions |
| `PageLayout.Content` | Card wrapper for page content |

## Dashboard Layout

Wrap pages with `DashboardLayout` for navigation sidebar.

```tsx
import { DashboardLayout } from "~/components/DashboardLayout";

// Standard layout
<DashboardLayout>
  <PageContent />
</DashboardLayout>

// Compact menu for busy pages
<DashboardLayout compactMenu>
  <PageContent />
</DashboardLayout>
```

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
import { Checkbox } from "../../components/ui/checkbox";

<Checkbox checked={isChecked} onCheckedChange={({ checked }) => setChecked(checked)}>
  Enable feature
</Checkbox>
```

## Icons

Use lucide-react for all icons:

```tsx
import { LuPlus, LuTrash, LuPencil, LuCheck, LuX } from "react-icons/lu";

<Button>
  <LuPlus /> Add Item
</Button>
```

## Tooltip

```tsx
import { Tooltip } from "../../components/ui/tooltip";

<Tooltip content="Helpful description" positioning={{ placement: "top" }} showArrow>
  <Button>Hover me</Button>
</Tooltip>
```

## Menu

```tsx
import { Menu } from "../../components/ui/menu";

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
</Menu.Root>
```

## Spacing Reference

| Token | Value | Use Case |
|-------|-------|----------|
| `1` | 4px | Tight spacing |
| `2` | 8px | Element margin |
| `3` | 12px | Small gaps |
| `4` | 16px | Standard gaps |
| `6` | 24px | Section padding |
| `8` | 32px | Large sections |
