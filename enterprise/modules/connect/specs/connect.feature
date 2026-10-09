Feature: The hosted end of Connect
  LangWatch Cloud serves a connected self-hosted install's hosted calls through the connect
  module (ARCHITECTURE.md section 11, "Hosted Connect is the connect module"). The gateway
  authenticates the call and resolves the caller; licensing answers which active licence the
  calling key runs under and its contract terms; connect judges, meters and caps.

  Rule: The hosted routes keep main's paths and the gateway's secret

    The three routes moved from licensing to connect with their paths and bodies unchanged.

    @unit
    Scenario: The hosted routes answer at their unchanged paths behind the gateway secret
      Given the connect module is installed beside the gateway
      When the Go data plane calls /api/internal/gateway/connect/instant-evals-classify, /usage or /budget
      Then an unsigned call is refused as unauthenticated at each path
      And a signed call reaches the route main served at that path

    @unit
    Scenario: A caller whose key has no active licence reads usage without a contract and cannot set a cap
      Given licensing names no active licence behind the calling key
      When the caller reads its hosted usage and then sets its cap
      Then the usage names no services and no contract
      And the cap is refused as connect_license_required, moving no budget

  Rule: Every deployment composes the hosted Connect services from their owners

    Main composed the hosted services on every deployment: instant-eval judges a hosted call,
    prices it at its judge's rate and records the spend under the calling key; the gateway keeps
    the budgets a connected install reads.

    @integration
    Scenario: A hosted judgement is priced at the rate of the judge that made it
      Given LangWatch Cloud judges hosted calls with a judge at its own rate and markup
      When connect asks what a judgement's input tokens were worth
      Then it is told the cost and the customer price at that judge's rate

    @integration
    Scenario: A hosted judgement stops when the calling install hangs up
      Given a hosted classify call is being judged
      When the calling install's request is abandoned
      Then the judge is handed that request's signal

    @integration
    Scenario: Hosted spend is billed to the calling key on the spend spine
      Given the spend spine is registered
      When a hosted call's spend is recorded
      Then one outcome at the customer price is recorded under the project's organization and the calling key

    @integration
    Scenario: Hosted spend is refused while the spend spine is not registered
      Given the spend spine is not registered
      When a hosted call's spend is recorded
      Then the record is refused, so the caller keeps the spend and tries again

    @unit
    Scenario: Hosted usage lists only the budgets that apply to the calling key
      Given the organization has budgets of which only some apply to the calling key
      When a connected install reads its hosted usage
      Then only the applicable budgets are listed, and the contract budget is marked as the contract

    @unit
    Scenario: Hosted usage resolves no team for a project authz does not know
      Given the calling key names a project authz holds no scope for
      When a connected install reads its hosted usage
      Then the budgets are resolved with no team rather than the read failing

    @unit
    Scenario: Hosted usage reports spend as unknown when live spend cannot be read
      Given live spend cannot be read
      When a connected install reads its hosted usage
      Then each budget's spend is unknown rather than zero

  Rule: The hosted Connect routes answer behind the gateway's own signed-call door

    Main mounted the hosted routes behind the gateway's signature check. The gateway hands its
    door out through its Api, so the hosted family verifies the same signature, never a copy.

    @unit
    Scenario: A hosted call with a bad signature is refused before any route runs
      Given the Go data plane's call is not signed with the gateway's secret
      When it reaches a hosted Connect route
      Then it is refused as unauthenticated and licensing is never asked for a licence

    @unit
    Scenario: A signed hosted call from a key without a licence is refused by its code
      Given a correctly signed hosted call from a key no licence carries
      When it asks for a hosted judgement
      Then it passes the gateway's door and is refused as connect_service_not_entitled

  Rule: The contract budget follows licensing's contract_terms_changed fact

    Licensing says the terms moved; connect brings the budget in line with the terms licensing
    answers now and writes it only through the gateway's operations. Connect owns no table.

    @unit
    Scenario: A contract_terms_changed fact syncs the contract budget
      Given licensing records a contract_terms_changed fact for an organization
      When connect's subscriber receives it
      Then the organization's contract budget is brought in line with its current terms

    @unit
    Scenario: A redelivered fact syncs to the same cap
      Given connect has already synced an organization's contract budget from a fact
      When the same fact is delivered again
      Then the budget is left at the same cap and no second budget is created

    @unit
    Scenario: The contract budget is the organization's live gateway budget named by the contract's id
      Given the organization's gateway budgets include one carrying the contract's external id
      When connect reads the organization's contract budget
      Then it answers that budget's limit in cents and whether the customer set the cap

    @unit
    Scenario: An archived contract budget is no contract budget
      Given the organization's only contract budget is archived
      When connect reads the organization's contract budget
      Then it answers none

    @unit
    Scenario: A new contract budget is a blocking organization budget under the contract's id
      Given an organization with agreed terms and no contract budget
      When connect creates its contract budget
      Then the gateway holds one blocking budget, capped by LangWatch, under the contract's id
