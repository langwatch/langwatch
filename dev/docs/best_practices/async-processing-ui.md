# Async processing UI

Some resources are not usable the instant they are created: a heavy upload, a
generated artifact, a long-running import. The backend does the work
off-request and the row carries a `status` lifecycle
(`processing` → `ready` / `failed`). The UI's job is to reflect that lifecycle
without leaking how the work is done, and to never read the resource before it
is ready.

This is the pattern. The dataset upload is the reference implementation
(`src/pages/[project]/datasets/[id].tsx`); reuse it for the next
processing-then-ready resource instead of reinventing the poll/banner/gate.

## 1. Poll the status with a self-stopping interval

Read the resource's status with a `getById`-style tRPC query whose
`refetchInterval` is a **function**: it returns a poll delay while the status is
non-terminal and `false` once it settles. The functional form lets the query
schedule its own stop, so you never need a `useEffect` to clear a timer.

```tsx
const datasetQuery = api.dataset.getById.useQuery(
  { projectId: project?.id ?? "", datasetId },
  {
    enabled: !!project && !!datasetId,
    refetchInterval: (data) =>
      data?.status === "processing" || data?.status === "uploading"
        ? 3000
        : false,
  },
);
```

Reference: `src/pages/[project]/datasets/[id].tsx` (the `getById` poll). The
functional-`refetchInterval` idiom mirrors
`src/features/traces-v2/hooks/useTraceFacets.ts`, where the same form drives a
cold-miss backoff poll that stops as soon as the payload settles. Read the
interval from `data`, not from React state — the scheduler reads it outside the
render cycle.

## 2. Render a Chakra `Alert` banner for processing / failed

One banner, driven by `status`. Processing gets a spinner; failed gets a
message and a **Retry** affordance. Use Chakra `Alert.Root` /
`Alert.Indicator` / `Alert.Content`, the same primitive the experiment views use
(`src/components/experiments/DSPyExperiment.tsx`).

```tsx
{(status === "uploading" || status === "processing") && (
  <Alert.Root status="info">
    <Alert.Indicator><Spinner size="sm" /></Alert.Indicator>
    <Alert.Content>
      <Alert.Title>Preparing your dataset, this can take a few minutes</Alert.Title>
    </Alert.Content>
  </Alert.Root>
)}
{status === "failed" && (
  <Alert.Root status="error">
    <Alert.Indicator />
    <Alert.Content>
      <Alert.Title>We could not prepare your dataset</Alert.Title>
      <Alert.Description>{statusError ?? "Something went wrong. You can retry."}</Alert.Description>
    </Alert.Content>
    <Button loading={isRetrying} onClick={handleRetry}>Retry</Button>
  </Alert.Root>
)}
```

Retry calls the backend's re-enqueue endpoint and then refetches the status
query, so the banner returns to the processing state on its own.

## 3. Gate the dependent read on `status === 'ready'`

The heavy read (the rows, the artifact body) must not fire while the resource is
processing. Gate the dependent query's `enabled` on readiness so it only runs
once the status settles:

```tsx
const isReady = status === "ready" || status == null;
// ...
<DatasetEditorTable datasetId={datasetId} readEnabled={isReady} />
// inside the table:
api.datasetRecord.getAll.useQuery(args, {
  enabled: !!project && !!datasetId && readEnabled,
});
```

Belt and suspenders on the server: the read procedure maps a not-ready resource
to a precondition failure rather than serving partial data — tRPC
`PRECONDITION_FAILED`, REST `425`
(`src/server/api/routers/datasetRecord.ts`). A consumer that can still fire a
read before the gate flips should pass `retry: false` so it surfaces the
precondition failure once instead of hammering the endpoint while it waits.

Decide the gate and the banner at the **page** (it owns routing and the status),
and pass `readEnabled` down to the component — don't let a leaf component
re-derive readiness.

## Copy rules

User-facing copy describes what the customer gets, never how the work is done
(`copywriting.md`):

- No internal step or concept names — not "chunking", "normalizing", "staging",
  "enqueuing". Say **"Preparing your dataset"**.
- No progress percentage you can't honestly compute. A spinner plus a realistic
  expectation ("this can take a few minutes") beats a fake bar.
- A failure message is a plain apology plus the next action, not a stack trace:
  **"We could not prepare your dataset"** + a Retry button. Surface a
  backend-provided detail only if it is itself user-safe.
- No em dashes in copy; use a comma or colon.

## Reference implementation

- Poll + banner + retry + read-gate: `src/pages/[project]/datasets/[id].tsx`
- Functional `refetchInterval` idiom: `src/features/traces-v2/hooks/useTraceFacets.ts`
- `Alert` banner primitive: `src/components/experiments/DSPyExperiment.tsx`
- Gated dependent read: `src/components/datasets/editor/DatasetEditorTable.tsx`
- Server not-ready mapping: `src/server/api/routers/datasetRecord.ts`
- Architecture: ADR-032 (`dev/docs/adr/032-datasets-s3-jsonl.md`), Decision 6 / I-READY.
