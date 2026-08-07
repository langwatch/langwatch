# ADR-088: a Terraform provider is the north-star consumer of the management APIs

**Date:** 2026-08-07

**Status:** Draft

**Relates to:** [ADR-001](./001-rbac.md) (the organization, team, project hierarchy the resources mirror), [ADR-021](./021-multi-scope-targeting-and-tenancy.md) (multi-scope targeting and single-organization tenancy), [ADR-045](./045-domain-errors-handled-boundary.md) (handled errors and their stable codes), [ADR-019](./019-repository-service-layering.md) (the service layer every REST route goes through).

## Context

A customer evaluating LangWatch could not provision it programmatically. Projects, teams and API keys had REST surfaces, but the organization itself, its members, its invites, custom roles, role bindings and SCIM tokens did not, so any serious rollout ended in a person clicking through Settings. The management APIs shipped to close that gap.

That work needed a design authority. "Make it REST" decides nothing: it does not say whether creating the same thing twice is an error, whether a read returns what a write accepted, or what a caller is supposed to do with a failure. Without an answer, each family invents its own, and the surface as a whole becomes unusable by exactly the tools it was built for.

We picked one: **a Terraform provider is the consumer these APIs are designed for**, even though we are not building it yet. Terraform is the most demanding realistic client. It reads before it writes, writes only differences, runs the same configuration repeatedly and expects the second run to do nothing, and it has to explain to a human what it is about to change before it changes it. An API that satisfies that satisfies a shell script, a CI job, a Pulumi provider and an agent, because all of them want a subset of the same guarantees.

This ADR records that framing and what it already decided, so the next person adding an endpoint knows what the surface is being held to. It is a thinking document. Nothing here commits us to shipping a provider, and nothing here is a build plan.

## Decision

**We treat "could a Terraform provider be built on this without contortions?" as the acceptance question for the management APIs**, and we keep the resource mapping below in mind when shaping new endpoints.

### The resources, and the endpoints behind them

The mapping is deliberately boring. One provider resource, one API family, no aggregate resources that would have to be assembled from several calls:

| Provider resource | API family | Note |
|---|---|---|
| `langwatch_organization` | `POST /api/organizations` | Self-hosted only, instance administrator credential |
| `langwatch_project` | `/api/projects` | Already existed |
| `langwatch_team` | `/api/teams` | Already existed |
| `langwatch_group` | `/api/groups` | Access groups, including the ones SCIM owns |
| `langwatch_custom_role` | `/api/roles` | |
| `langwatch_role_binding` | `/api/role-bindings` | User, group or API key principal |
| `langwatch_api_key` | `/api/api-keys` | |
| `langwatch_scim_token` | `/api/scim-tokens` | |
| `langwatch_organization_member` | `/api/organization/members` | Manages someone already in the organization |
| `langwatch_organization_invite` | `/api/organization/invites` | The only way somebody new arrives |

Two of those pairs are worth stating out loud. A member and an invite are separate resources because they are separate lifecycles: an invite is created and either accepted or revoked, and a membership only exists once a human accepted something. Modelling them as one resource would mean a provider blocking on a person's inbox, which is not a thing a plan can wait for.

A group and a role binding are separate for the same reason SCIM keeps them separate: an identity provider owns who is in the group, and LangWatch owns what the group reaches. A provider can manage the second even when it must not touch the first.

### The principles this framing produced

These are not aspirations. Each is already in the surface, and each is there because a provider would otherwise be unbuildable or dishonest.

**Natural keys, and conflicts that mean something.** Where a human-chosen unique name exists, it is the key: a role's `name`, an organization's `slug`. Creating one that is taken answers a specific code (`custom_role_name_taken`, `organization_slug_taken`, `role_binding_already_exists`, `duplicate_invite`) rather than a generic 500 or, worse, a second near-identical row. A provider needs to tell "somebody else already made this" apart from "the server is broken", and only a deterministic code does that.

**Read-back parity.** A `GET` returns every field a write accepts. This is what makes a plan diff honest: if a read cannot see a field, a provider either shows a permanent diff on it or ignores it silently, and both are lies. The API-key detail response goes furthest, returning bindings in exactly the shape a write takes, so comparing desired against actual is a comparison rather than a translation.

**`PATCH` is partial, and set-valued fields replace.** Sending one field changes one field. Sending a set (a role's `permissions`, a key's `bindings`) replaces that set outright. A declarative tool computes the whole desired set anyway, and merge semantics would make removing a permission impossible without a separate delete verb.

**A delete of something missing is a stable 404.** `custom_role_not_found`, `role_binding_not_found`, `scim_token_not_found`, `invite_not_found`. A provider reads that as "already gone" and converges, which is the correct outcome when a destroy is retried after a partial failure.

**Stable error codes everywhere.** Per ADR-045, the code is the contract and the message is copy. A provider branches on the code, and its error output is only as useful as the codes behind it.

**The organization comes from the credential.** `/api/organization`, `/api/roles`, `/api/role-bindings` and `/api/scim-tokens` carry no organization id. A provider configures one credential per organization, the way the AWS provider configures one account per provider block, and the same configuration then applies to any organization by swapping the credential.

### The bootstrap chain

A provider has to start somewhere, and the somewhere cannot be a browser. On a self-hosted instance the chain is:

```
LANGWATCH_INSTANCE_ADMIN_API_KEY
        |
        v
POST /api/organizations   ->   organization + an organization admin API key
        |
        v
everything else: teams, groups, roles, role bindings, members,
invites, projects, API keys, SCIM tokens
```

The instance credential exists before any organization does, so it authenticates against the instance rather than an organization, and the family is absent (404, not 403) when the variable is unset or the deployment is LangWatch Cloud. Creating an organization returns an organization-scoped admin key precisely so the chain can continue without a human step. In provider terms that is one resource whose output feeds the provider configuration of everything downstream, which is a shape Terraform handles and which stops working the moment a browser is in the middle.

## Rationale and trade-offs

The alternative was to design for the client we actually have, the CLI, and let a provider adapt later. We rejected it because the adaptation always lands on the API. A CLI is happy with any semantics: it is driven by a person who reads the error and tries something else. A provider is not, and retrofitting idempotency and read-back parity onto a shipped surface means either breaking changes or a provider full of workarounds that leak into every plan output its users read.

The cost is real. Read-back parity constrains what a response may omit, which is why the S3 secret is write-only and conspicuous rather than quietly absent, and why the single sign-on fields are excluded with a stated reason rather than silently. Natural keys mean a name change is a semantically loaded operation rather than a field edit. Deterministic conflict codes mean every new failure gets named, registered and given customer-facing copy instead of falling into "unknown".

We also accepted that some of this is currently paid for by nobody. There is no provider today. If one is never built, the surface is still better for the CLI and for agents, but the cost was incurred for a consumer that did not arrive. We think that is the right bet, because the properties are the ones any automated client wants and because they are far cheaper to establish now than to retrofit.

## Consequences

New endpoints on these families inherit an acceptance question rather than a style guide. Before adding one: can it be run twice, can its result be read back in the shape it was written, and does its failure carry a code a machine can branch on? A "no" is not automatically disqualifying, but it needs a reason in the same way an exclusion needs a reason.

Error-code bookkeeping is now load-bearing rather than tidiness. Every conflict a provider would need to distinguish is a code that has to exist, be listed, and carry copy.

And the shape of a provider, if we build one, is already decided by the table above. What is left is the work Terraform itself imposes, not the work of deciding what the resources are.

## Open questions

Deliberately unanswered. Each needs its own decision, and none blocks the APIs as they stand.

**Import.** Terraform import needs a stable, human-writable address for an existing resource. Some resources have an obvious one (a role by name, an organization by slug); others only have an opaque id, and a binding is identified by a principal, a role and a scope together. Whether we support import for everything, for the addressable subset, or not at first is undecided.

**Drift on fields the API cannot read back.** An API key's token and a SCIM token's value are returned once and never again, by design. A provider therefore cannot detect that a secret was rotated outside Terraform, and storing it in state means the secret lives in state. Whether these are write-only attributes, ephemeral resources, or simply not managed by the provider is an open question, and it is the sharpest one here: it is where the security property and the drift-detection property genuinely conflict.

**Organization deletion.** There is no `DELETE /api/organizations/{id}`, so `terraform destroy` cannot fully reverse a `langwatch_organization`. Deleting an organization takes everything in it, and we are not convinced that should be reachable from an automated run at all. Leaving the resource non-destroyable, adding a guarded delete, or modelling deletion as an out-of-band operation are all still open.

**Organization creation on LangWatch Cloud.** Out of scope on purpose. Cloud organizations carry billing and plan state that provisioning does not currently touch, so the instance-administrator path is self-hosted only. If Cloud ever gains an equivalent, it is a separate decision with its own constraints.

**How a provider would be built at all.** Terraform plugin framework, a generated provider from the OpenAPI document, or something else. Nothing above depends on the answer, which is exactly why it is last.
