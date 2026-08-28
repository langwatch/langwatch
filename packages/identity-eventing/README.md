# @langwatch/identity-eventing

The identity platform's **event-sourcing layer**: the framework envelope over
`@langwatch/identity`'s fact payloads, the thin command handlers that run
`@langwatch/identity-server`'s guards, the fold projections, the two process
managers, and the four pipeline definitions a worker registers.

```text
 @langwatch/identity          pure vocabulary, facts, reducers, errors
        ▲
 @langwatch/identity-server   guards, services, ports — no storage engine,
        ▲                     no framework, no better-auth
 @langwatch/identity-eventing  ← you are here: envelopes, commands, folds,
                                process managers, pipelines
```

[ADR-115](../../dev/docs/adr/115-identity-ships-as-packages.md) put this half in
`platform/app`, because at the time the app was the only process that composed
it. The core application exit deletes that host, so it lives in its own package
rather than inside `@langwatch/identity-server` — which keeps ADR-115's rule
that the server runtime never imports the event-sourcing framework, and keeps
the API and worker processes able to import the envelope without importing each
other.

## The four pipelines

| Pipeline | Aggregate | What it is |
| --- | --- | --- |
| `identity` | `user_identity` | ADR-101 / D01 identifiers, and D06 two-step verification on the same aggregate so a person's commands serialise against each other |
| `sso-connections` | `sso_connection` | D04 / ADR-117 §5 connection lifecycle, with the teardown grace timer |
| `join-requests` | `join_request` | D12 join requests, with the day-7 reminder and day-14 expiry on one wake |
| `scim-sync` | `scim_sync` | D08 directory sync; no process manager, deliberately |

Every one of them ships **dark**: nothing dispatches their commands until the
owning feature flag is on, and until this branch nothing registered them at all.

## What this package does not own

No storage engine and no composition. Every projection store, guard instance
and process port arrives as a constructor argument, exactly as it did when the
registry in `platform/app` supplied them. The worker installers in
`apps/worker/src/features/identity/` decide when a pipeline is registered; the
application's composition root decides what it is registered with.

## Testing

`src/testing.ts` (`@langwatch/identity-eventing/testing`) carries the in-memory
`IdentityUsersRepository` and `IdentityReservationRepository` doubles the guards
need wherever they are constructed — the pipeline's staged re-run included. It
is exported rather than re-declared per suite so that a suite cannot quietly
stub `findUserIdByEmail` looser than the real repository and prove the guard
against a population that cannot collide (ADR-116 §6).
