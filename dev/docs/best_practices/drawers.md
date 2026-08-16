# Drawers

Drawers are URL-routed. Opening a drawer pushes a `drawer.open=<name>`
query param onto the page URL; closing pops it. The shell that renders
the drawer (`<CurrentDrawer />`, mounted once near the app root) keys
off that param and resolves the component via `drawerRegistry`.

Always render through the shared `Drawer.Root` wrapper
(`components/ui/drawer.tsx`), never raw Chakra. Drawers anchor to the right
(`end`) as usual even while the Langy panel is open: the panel notices the
open drawer and re-seats ITSELF as a floating companion card beside the
drawer (same height, same radius, a strip of space between the two), then
returns to its dock when the drawer closes. Nothing to do per drawer; the
panel owns that dance. Spec: specs/langy/langy-panel-layout.feature.

This is the only pattern. Don't reach for `useState`-driven open/close
on a new drawer — the URL form gives you:

- a stable deep-link (paste the URL, the drawer is open with the same target),
- back/forward history (browser back closes the drawer),
- shareable state for support / repro recordings,
- no prop drilling for the open flag.

## Adding a new drawer

1. Add the component under `src/components/.../<MyDrawer>.tsx`. It
   should render `Drawer.Root` with `open={true}` (the registry only
   mounts it when active), and call `closeDrawer()` from
   `useDrawer()` on the close trigger.

2. Define the props as a single `interface Props` — the props you
   accept become serializable URL parameters by default. Use scalar
   types (strings, numbers, booleans) and an optional `editingId` /
   `targetId` style identifier instead of passing full row objects.
   Fetch the row through a tRPC query inside the drawer.

   ```ts
   interface Props {
     editingId?: string;
   }
   export function MyDrawer({ editingId }: Props) {
     const { closeDrawer } = useDrawer();
     const dataQuery = api.x.getOne.useQuery(
       { id: editingId ?? "" },
       { enabled: !!editingId },
     );
     // ...
   }
   ```

3. Register in `src/components/drawerRegistry.ts`:

   ```ts
   export const drawers = {
     // ...
     myDrawer: MyDrawer,
   } satisfies Record<string, React.FC<any>>;
   ```

   The registry inference picks up the props automatically, so
   `openDrawer("myDrawer", { editingId: "abc" })` is fully type-safe
   at the call site.

4. Open from any component via `useDrawer().openDrawer("myDrawer",
   { editingId })`. The hook handles URL serialization, push vs
   replace, and the navigation stack for back-button behavior.

## Going to another drawer and back

A step that needs another drawer (pick an evaluator, create a dataset)
NAVIGATES to it and returns. Never mount a drawer component directly with
`useState`/`useDisclosure`: only one drawer mounts at a time, so a
hand-mounted one stacks a second `Drawer.Root` over the open drawer and
sits outside the history the hook keeps.

```ts
const { openDrawer, goBack } = useDrawer();

openDrawer("addOrEditDataset", {
  onSuccess: (created) => { /* record the result */ },
  onClose: goBack, // both endings return to this drawer
});
```

`openDrawer` pushes onto the drawer stack, so `goBack` returns to the
caller with its URL params restored. Callbacks that cannot live in a URL
travel through the props slot, as above, or through `setFlowCallbacks`
when the target drawer reads them by name
(`OnlineEvaluationDrawer` is the worked example).

Two things to get right, or the return trip lands somewhere wrong:

- **The caller's own state must survive its unmount.** The push unmounts
  the calling drawer exactly like closing it does. Draft state therefore
  belongs in a store that outlives the component, and any reset-on-unmount
  must be able to tell a departure from a close
  (`features/automations/state/automationStore.ts`).
- **Pass `onClose`, not `closeDrawer`.** A target drawer closing itself
  clears the whole stack, which drops the caller too.

## Non-serializable props (rare)

If a drawer genuinely needs an in-memory payload that can't be
reconstructed from a URL parameter (e.g. a complex callback the
caller wants to run on save), useDrawer's `complexProps` slot keeps
it in memory and threads it to the next mount. Prefer fetching the
data inside the drawer over this escape hatch — the URL form must
always carry enough state to reconstitute the drawer from a paste.

## Testing

Drawers are mounted by `<CurrentDrawer />` outside the section that
opens them, so component tests of the opener can assert by mocking
`useDrawer`:

```ts
const mockOpenDrawer = vi.fn();
vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: mockOpenDrawer, /* ... */ }),
}));

it("opens the drawer with the row id", () => {
  // ...
  expect(mockOpenDrawer).toHaveBeenCalledWith("myDrawer", {
    editingId: "row-1",
  });
});
```

Full end-to-end tests (router + `CurrentDrawer` + the drawer itself)
go in `*.integration.test.tsx` with a Next.js router mock that lets
`useDrawer` write to the URL.
