# Design Guidelines

These guidelines establish the visual language and interaction patterns for LangWatch. They were introduced in [PR #1025](https://github.com/langwatch/langwatch/pull/1025) and should be followed for all new development.

## 1. Rounded Corners

All UI elements should have a rounded, approachable feel.

### Implementation

- Default border radius: `lg` (8px)
- Menu selections should not touch container edges
- Cards, buttons, and inputs should feel soft and modern

### Code Pattern

```tsx
// Cards and containers
<Card.Root borderRadius="lg">
  ...
</Card.Root>

// Inputs
<Input borderRadius="lg" />

// Custom containers
<Box borderRadius="lg" border="1px solid" borderColor="gray.200">
  ...
</Box>
```

## 2. Translucent Overlays

All overlays (drawers, popovers, dialogs) should have translucent backgrounds with blur effects.

### Visual Effect

- Semi-transparent white background
- Backdrop blur for depth
- Rounded floating corners with margin from edges

### Implementation Details

The overlay components in `components/ui/` already implement these styles:

| Property | Value |
|----------|-------|
| `background` | `white/75` |
| `backdropFilter` | `blur(8px)` |
| `borderRadius` | `lg` |
| `margin` | `2` (for drawers) |

### Code Pattern

```tsx
// These components already have the translucent effect built-in:
import { Drawer } from "../../components/ui/drawer";
import { Dialog } from "../../components/ui/dialog";
import { Popover } from "../../components/ui/popover";

// If creating custom overlays, apply:
<Box
  background="white/75"
  backdropFilter="blur(8px)"
  borderRadius="lg"
>
  ...
</Box>
```

## 3. Prefer Drawers Over Modals

Use drawers for resource selection, creation, and editing flows. Drawers maintain context by keeping the underlying page visible.

### When to Use Drawers

- Creating new resources (prompts, triggers, datasets)
- Editing existing resources
- Resource selection interfaces
- Configuration panels
- Detail views

### When to Use Dialogs

- Confirmation prompts (delete, discard changes)
- Simple alerts and messages
- Quick actions that don't require context

### Placement

- Use `placement="end"` (right side) for most drawers
- Common sizes: `md`, `lg`, `xl`

### Nested Drawer Navigation

LangWatch uses a drawer navigation system that allows drawers to navigate to other drawers while maintaining a back button. This is preferred over true nested/stacked drawers.

**Key Concepts:**

1. **Drawer Stack** - Navigation history is tracked in a stack
2. **URL-based state** - Drawer state is stored in URL params for shareability
3. **Flow Callbacks** - Callbacks can persist across drawer navigation
4. **Back Button** - Automatically appears when there's navigation history

**When to use drawer navigation:**

- Multi-step selection flows (e.g., select type → select item → configure)
- Drill-down interfaces (list → details → edit)
- Wizard-like flows within drawers

**Implementation:**

```tsx
import { useDrawer } from "~/hooks/useDrawer";

function ParentDrawer() {
  const { openDrawer, canGoBack, goBack, closeDrawer } = useDrawer();

  return (
    <Drawer.Root>
      <Drawer.Header>
        <HStack gap={2}>
          {canGoBack && (
            <Button variant="ghost" size="sm" onClick={goBack}>
              <ArrowLeft />
            </Button>
          )}
          <Heading>Select Type</Heading>
        </HStack>
      </Drawer.Header>
      <Drawer.Body>
        <Button onClick={() => openDrawer("childDrawer", { id: "123" })}>
          Open Child
        </Button>
      </Drawer.Body>
    </Drawer.Root>
  );
}
```

See [components.md](./components.md) for detailed `useDrawer` hook documentation.

## 4. Page Layout Standards

All pages should follow a consistent layout structure.

### Structure

1. **Header** - Fixed height (48px), contains title and actions
2. **Title** - Small, left-aligned heading
3. **Action Buttons** - Top right, using `PageLayout.HeaderButton`
4. **Content** - Full width, below the header divider

### Code Pattern

```tsx
import { PageLayout } from "../../components/ui/layouts/PageLayout";

<PageLayout.Container>
  <PageLayout.Header>
    <PageLayout.Heading>Page Title</PageLayout.Heading>
    <Spacer />
    <HStack gap={2}>
      <PageLayout.HeaderButton onClick={handleAction}>
        <Plus /> Add Item
      </PageLayout.HeaderButton>
    </HStack>
  </PageLayout.Header>

  {/* Page content below header */}
  <VStack gap={4} padding={6}>
    ...
  </VStack>
</PageLayout.Container>
```

### Key Points

- Page takes full available width
- Title should be concise
- Action buttons grouped on the right
- Consistent padding and spacing

## 5. Collapsed Menu for Busy Pages

For content-heavy pages, use the compact sidebar that expands on hover.

### When to Use Compact Menu

- Pages with dense content (prompt editor, settings)
- Pages where users need maximum horizontal space
- "Focused mode" pages where navigation is secondary

### Implementation

```tsx
import { DashboardLayout } from "~/components/DashboardLayout";

<DashboardLayout compactMenu>
  {/* Page content */}
</DashboardLayout>
```

### Behavior

- Sidebar collapses to icons only
- Expands on hover to show labels
- Maintains navigation accessibility
- Reduces visual noise

## 6. Form Validation: Submit-then-Surface, Don't Pre-Disable

Forms always allow Save to be clicked. Validation runs on submit and surfaces errors inline (field-level) and/or via toast (cross-field or backend). The Save button is disabled **only** while a request is in flight.

### Why

- A disabled button doesn't tell the user what's wrong. Inline errors do.
- Users sometimes click Save expecting to discover what's missing. A pre-disabled button is silent and frustrating.
- Async validation (uniqueness checks, server-side rules) can't always pre-compute disabled state — the button would lie about readiness.

See [ADR 018](../adr/018-form-validation-and-save.md) for the full decision context.

### Implementation

```tsx
<Button
  type="submit"
  disabled={mutation.isPending}  // ✅ in-flight only
  // disabled={!form.formState.isValid}  // ❌ don't pre-disable
>
  Save
</Button>
```

For validation:

- **Field-level (sync schema rules):** Use `react-hook-form` + `zodResolver`, render inline via `<Field.ErrorText>`.
- **Cross-field, checked client-side:** Validate inside the submit handler. On failure, call `toaster.create({ type: "error", title, description })` and `return` before any mutation fires. This is your own copy, so `toaster` is fine here.
- **Server errors (any mutation `onError`):** Never `toaster.create` an error yourself, and never render `error.message` — since #5984 a handled error's tRPC wire message is its `code`, so that shows the customer `validation_error`. Use `showErrorToast`, which takes its copy from the code-keyed presentation registry.
- **A server rejection that names fields:** Put it back on those fields with `applyHandledErrorToForm`, paired with `<FormServerError form={form} />` for complaints about the submission as a whole.

```tsx
import {
  applyHandledErrorToForm,
  FormServerError,
  showErrorToast,
} from "~/features/errors";

const mutation = api.team.update.useMutation({
  onError: (error) => {
    // Marks the fields it owns. Returns false when it can't show the whole
    // rejection — including a partial match, where the fields ARE marked and
    // the toast still fires for the rest.
    if (applyHandledErrorToForm({ error, form, hasFormErrorSlot: true })) return;
    showErrorToast({ error, fallbackTitle: "Couldn't save the team" });
  },
});

const handleSubmit = async () => {
  // Cross-field check — our own copy, so toaster is right
  if (useAsDefault && !defaultModel.startsWith(`${provider}/`)) {
    toaster.create({
      title: "Cannot save: pick a model from this provider",
      description: "…",
      type: "error",
    });
    return;
  }
  await mutation.mutateAsync(payload);
};

// …and, at the top of the form, the slot the `true` above promised:
<FormServerError form={form} />
```

`hasFormErrorSlot: true` is a promise that this form renders `<FormServerError>`.
Get it wrong and a form-level rejection is claimed, the toast is suppressed, and
Save appears to do nothing.

### Anti-patterns

- ❌ `disabled={!isValid}` — forces the user to find what's wrong without help.
- ❌ Silent no-op on submit — appears to succeed; persists nothing or persists garbage.
- ❌ Validation that only renders if a field is touched — invisible until the user randomly stumbles on it.
- ❌ `toaster.create({ type: "error", description: error.message })` — renders a code slug at the customer, and a build guard fails on it. Use `showErrorToast`.
- ❌ A server field rejection surfaced as a toast — the user has to translate it back onto the form themselves.

## Summary Checklist

When implementing new features, verify:

- [ ] Border radius uses `lg` for containers and interactive elements
- [ ] Overlays use translucent backgrounds with blur
- [ ] Resource management uses drawers, not modals
- [ ] Page follows standard layout (header, title, actions)
- [ ] Content-heavy pages use compact menu
- [ ] Components imported from `components/ui/` where available
- [ ] Save buttons disable only on `isPending`, never on `!isValid`
- [ ] Validation errors surface inline or via toast; Save never silently no-ops
