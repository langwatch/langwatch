# Legacy project-key policy handoff

This is a note for a later architecture PR, not a completed cutover. The current
transport checks are intentional compatibility boundaries until the catalogue
owner adopts one central policy as canonical authorization. The authorized
response mapper must use that policy to redact secret fields, while the
application/action boundary must use the same policy to authorize reveal,
rotation, and exchange. Domain services remain free of permission branching.
That adoption should implement
[ADR-092](../adr/092-unified-authorization-engine.md), not add a second role
engine. After cutover, transports must not duplicate these checks; the mapper
alone is not sufficient to authorize writes or exchange.

The policy must preserve session and device-verified-principal provenance; an
API key must never become an owner session. Exact-project reveal and rotation
require `project:manage`. Aggregate and personal-context responses omit the
secret rather than denying the surrounding context. Exchange must recheck the
caller's current admin authority and the fresh key, then consume the exchange;
any failed check denies the exchange. Existing keys remain valid only for their
one project until rotation, and modern-key authorization remains the
intersection of key scope and owner authority.

The architecture PR must cover happy paths plus stale-admin, wrong-project,
missing-`project:manage`, replayed/expired exchange, rotated-key, forged
principal, and API-key-to-owner-session attacker cases.
