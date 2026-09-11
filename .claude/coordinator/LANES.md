# Live lanes

The coordinator's only piece of state that is not otherwise on disk. Manifests
say what a lane was asked to do; handoffs say where it got to; this says
**which lanes are running right now**.

It exists so the question "can this coordinator session be replaced?" has a
checkable answer rather than depending on what one session happens to remember.

Gitignored. It describes this checkout at this moment, not the repository.

## The rule

- Write the row **before** the Agent call, not after. A lane spawned and not
  recorded is exactly the lane a rotating coordinator orphans.
- Clear the row when you have read its handoff and committed or rejected its
  slice - not when it reports, and not when you start reading.
- `active` rows are the ceiling from COORDINATOR.md section 2. Three.

## Rotating the coordinator

Safe when this file has **no `active` rows**. Then everything the next
coordinator needs is in the manifests, the handoffs and the drive document, and
this session can end.

Not safe with an `active` row: that lane is tied to this session, its result is
not yet on disk, and ending the session pays for the lane without collecting it.
Wait for it, collect it, clear the row, then rotate.

A row still `active` with no output for longer than its whole budget is wedged,
not working. Stop it, keep whatever handoff exists, clear the row.

## Rows

| Lane | Manifest | Model | Spawned | Status |
| --- | --- | --- | --- | --- |
