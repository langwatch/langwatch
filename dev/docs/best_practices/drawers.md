# Drawers

Drawers are URL-routed. Opening a drawer pushes a `drawer.open=<name>`
query param onto the page URL; closing pops it. The shell that renders
the drawer (`<CurrentDrawer />`, mounted once near the app root) keys
off that param and resolves the component via `drawerRegistry`.

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
