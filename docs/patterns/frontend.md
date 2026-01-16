# Frontend Patterns

## Chakra UI v3

We use Chakra v3. Key changes from v2:

### Icons
Use `lucide-react` icons exclusively.

### Toasts
```tsx
import { toaster } from "components/ui/toaster";

toaster.create({
  title: "Title",
  description: "Description",
  type: "error",  // not "status"
  meta: { closable: true }
});
```

### Component Renames

| v2 | v3 |
|----|-----|
| Modal | Dialog |
| Divider | Separator |
| Collapse | Collapsible |
| useToast | toaster.create() |
| spacing | gap |
| isOpen | open |
| onClose | onOpenChange |

### Component Structure Changes

**Dialog (formerly Modal):**
```tsx
<Dialog.Root open={open} onOpenChange={setOpen}>
  <Dialog.Trigger />
  <Dialog.Content>
    <Dialog.CloseTrigger />
    <Dialog.Header><Dialog.Title /></Dialog.Header>
    <Dialog.Body />
    <Dialog.Footer />
  </Dialog.Content>
</Dialog.Root>
```

**Table:**
```tsx
<Table.Root>
  <Table.Header>
    <Table.Row><Table.ColumnHeader /></Table.Row>
  </Table.Header>
  <Table.Body>
    <Table.Row><Table.Cell /></Table.Row>
  </Table.Body>
</Table.Root>
```

**Tabs:**
```tsx
<Tabs.Root defaultValue="tab1" onValueChange={(e) => setValue(e.value)}>
  <Tabs.List>
    <Tabs.Trigger value="tab1" />
  </Tabs.List>
  <Tabs.Content value="tab1" />
</Tabs.Root>
```

### Import Sources

**From `components/ui/`:**
Checkbox, CheckboxGroup, Drawer, Radio, RadioGroup, InputGroup, Switch, Popover, Link, Menu, Dialog, Tooltip

**From `@chakra-ui/react`:**
Alert, Avatar, Button, Card, Field, Table, Input, Select, NativeSelect, Tabs, Textarea, Separator, useDisclosure

### Other Notes

- `useDisclosure`: `isOpen` → `open`, added `setOpen`
- Buttons: `leftIcon`/`rightIcon` → just put icons inside
- InputGroup: use `startElement`/`endElement` props
- Links: use our `Link` with `isExternal` prop
- DO NOT change `function` declarations to `const`

## File Structure

Pages handle routing (permissions, layout). Components handle UI.

```
src/pages/[project]/prompts.tsx              # Routing
src/prompt-configs/components/PromptsPage.tsx # UI
```

- Thin files with single responsibility
- Single export per file
- Directories: `hooks/`, `components/`, `pages/`
