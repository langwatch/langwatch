# Gateway budget enforcement has no test that reaches its logic

Found while working down `typecheck:tests`. Recorded rather than fixed: the
repair needs a decision about which layer the coverage belongs to, and the
answer probably moves it into the datastore lane.

## What happened

`GatewayService.check` used to hold the budget evaluation. It is now two
lines:

```ts
async check(input: BudgetCheckInput): Promise<BudgetCheckResult> {
  const tenantIds = await this.listSpendTenantIds(input.organizationId);
  return this.repository.check({ ...input, tenantIds });
}
```

The evaluation — which budgets apply, what has been spent against them, which
produce warnings, which block — moved to
`PrismaGatewayBudgetRepository.check`.

`budget.service.unit.test.ts` did not move with it. Its 16 cases still assert
allow / warn / block and projected-spend behaviour, and they still call
`GatewayService.create(prismaClient)` — a constructor that now takes
`{ repository, projects, cacheRules, guardrails }`. So all 16 fail, at run
time with `Cannot read properties of undefined (reading
'listIdsByOrganization')` and at typecheck with 28 errors.

## Why it matters more than a red suite

Those 16 cases are the ONLY coverage of budget-check evaluation anywhere in
the repository. `PrismaGatewayBudgetRepository.check` has no tests of its own,
and nothing else asserts a warning or a block.

So the code path that stops a customer spending past a budget they set is
currently guarded by nothing — not because someone removed a test, but because
the logic walked out from under one.

## The decision

Re-pointing the 16 cases at the repository is the obvious move, and it changes
their lane: `PrismaGatewayBudgetRepository` reads Postgres, so they stop being
unit tests. Either

1. **port them to the datastore lane** against a real Postgres, which is
   honest and slower, or
2. **give the repository a seam** — the evaluation is arithmetic over rows
   already fetched, so it could be a pure function the repository calls and a
   unit test drives directly, leaving only the fetch to an integration test.

(2) keeps the enforcement rules in the fast lane, which is where a rule that
decides whether to block a paying customer's request wants to be. It is also a
change to production shape, so it is not a test author's call.

## Not to be confused with

The service's own thin `check` is worth one test — that it resolves tenant ids
and passes them through — but that is a different claim from the sixteen, and
it would not have caught anything these are for.
