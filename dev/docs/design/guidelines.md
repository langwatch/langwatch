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

## Summary Checklist

When implementing new features, verify:

- [ ] Border radius uses `lg` for containers and interactive elements
- [ ] Overlays use translucent backgrounds with blur
- [ ] Resource management uses drawers, not modals
- [ ] Page follows standard layout (header, title, actions)
- [ ] Content-heavy pages use compact menu
- [ ] Components imported from `components/ui/` where available
