# Ownership moves after parity

Ruling (Alex, 2026-09-29): until the branch matches main, only merge defects and behaviour bugs against main get
fixed. Every ownership move below is deferred and does not change behaviour now. Evidence for each item is in the
2026-09-29 ownership audit; the boundary rulings are being taken in the "Ownership rulings" doc.

Each item has two parts: the move, and what to check when it rolls out.

## Money and data

1. **Entitlement owns one usage meter.** Today entitlement answers "may you?" for everyone, yet it asks trace,
   billing, licensing, user and project for counts, so nothing can depend on it without a cycle. The `Cost` table
   (written by evaluation and topic, summed by entitlement) has no owner.
   - Move: one meter fed by facts through projections (trace ingested, billable event, cost incurred, subscription
     or licence changed). `Cost` folds into the meter, and entitlement never calls a feature module.
   - Rollout: run old and new counts side by side and compare per organisation before switching limits over.
     Check gradual-rollout issues: a limit must never flip for a customer because of the switch.
2. **Governance ingest debits go through gateway.** Today `governance-ingest-receiver.service.ts` writes budget
   rows itself: no provider filter, a failed insert is dropped, no dedupe. Main does the same.
   - Move: governance sends one debit command and gateway decides.
   - Rollout: provider-scoped budgets will stop being debited with ingested spend, which changes the totals
     customers see. Announce it.
3. **One `personalBudgetStatus` in gateway.** It is computed in three places today, and the CLI and `/me` disagree
   for OTLP-only users. The CLI pre-flight answer may change for those users.
4. **Gateway is the sole writer of `VirtualKey` and `GatewayChangeEvent`; enterprise-gateway owns `RoutingPolicy`.**
   - Rollout: the revision drives Go config sync, so check that no revision bump is lost during the move.
5. **Secrets only through their owner.** gateway reads ModelProvider rows including `customKeys`; workflow reads
   `ProjectSecret.encryptedValue` and `project.apiKey`.
   - Order: workflow's move waits for audit-log to become a sink, otherwise it adds a cycle.
6. **Membership and Organization rows are written only through organization.** Today auth, identity, scim, authz,
   billing and licensing all write them. The design spec is in `ownership-membership-erase-design.md` once frozen.
   - Rollout: seat counts must not change.
7. **Owner-side erase and purge (§9.1).** Today they are hand-written over about 35 models in 15 modules.
   - Rollout: prove the new erase deletes exactly the rows the old one did, per model, before removing the old one.
8. **Gateway owns its spend schemas and envelope, and webhook delivers opaque envelopes.** Today webhook holds the
   copies.
   - Rollout: envelope bytes and ids must be identical.
9. **PostHog milestones move from billing to onboarding.** They are wired in billing for parity first.

## Retention

- **Pins are bookmarks, as on main.** Retention ignores them.
  - A future option to honour pins needs: a `DataRetentionApi.findPinChanges` pull by trace, owner-side re-stamping
    of `_retention_days` to 0, and a per-trace override in `.withRetention` for rows that arrive late.

## Boundaries and cycles

- The rulings on SSO, ops and licensing, analytics as a read model, scenario/suite/agent, role and authz,
  audit-log as a sink, viewer protections, automation pulling, and the peer-cycle foundation rule are taken in the
  Ownership rulings doc: https://claude.ai/code/artifact/bbeeac5a-b282-4321-b89e-e910c0c2fde4
- Build order after parity: cut the foundation edges first (§5), then the moves above.
