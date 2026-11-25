Feature: Customer.io hears when a person's gateway key is created, first used, and when its budget nears or hits its limit
  Gateway records a key's lifecycle and its budget's crossings as its own facts. Nurturing copies
  each key from the lifecycle facts and reads only its own copies (ADR-001): the key's name, the
  person it acts for, the person who created it, its purpose and its state. The copy is a peer map
  over those facts, one statement a fact, so a replay fills it at deploy from gateway's log, after
  the erasure marks are filled from user's and identity's erasure facts. One person hears each
  fact: the key's holder if they are a current member of its organization, else its creator if
  they are, else the organization's admin if they are, else no one. Connect and Langy keys send
  nothing. A key no person holds or made goes to the organization's admin.
  Gateway also records a key's first admitted request, once; the person told of the key's
  creation is then identified with has_app_request true. A first request that arrives before
  the key's copy is retried a bounded number of times, so it waits for the copy and never loops.
  On every sweep, gateway records an organization's person keys that spent without a budget;
  its admin is told once a week at most.

  @unit
  Scenario: A created person's key sets has_virtual_key and sends virtual_key_created
    Given a current member of an organization
    When gateway records a USER key created for them
    Then Customer.io identifies them with has_virtual_key true
    And tracks virtual_key_created to them with the key's name, id and organization only
    And each call is claimed on its own

  @unit
  Scenario: has_virtual_key stays true after the person's last key is revoked
    Given a person whose only key was created and has_virtual_key was set
    When gateway records the key revoked
    Then Customer.io receives no call, so has_virtual_key stays true

  @unit
  Scenario: An admin told of a key not theirs is not given has_virtual_key
    Given a created USER key whose holder and creator are not current members
    When the creation is delivered to the organization's admin
    Then virtual_key_created is tracked to the admin
    And Customer.io does not identify the admin with has_virtual_key

  @unit
  Scenario: Rotating, disabling, enabling or revoking a key sends nothing and updates the key copy
    Given a copied key
    When gateway records it rotated under a new name, disabled, enabled or revoked
    Then Customer.io receives no call
    And the key copy holds the new name and state
    And its creator stays the one the created fact named

  @integration
  Scenario: The key copy folds every lifecycle fact order-free in Postgres
    Given nurturing's key copy in Postgres
    When a key's facts arrive late, out of order and twice
    Then the copy holds the latest name, the created fact's creator, the latest non-null holder and purpose, and the latest state times

  @unit
  Scenario: A crossing for a revoked or disabled key sends nothing
    Given a copied key that was revoked, or disabled and not enabled again
    When gateway records a crossing of its budget
    Then Customer.io receives no call

  @unit
  Scenario: A threshold crossing sends key_budget_threshold with every attribute
    Given a copied USER key whose holder is a current member
    When gateway records its budget crossing the warn line, then breaching
    Then each sends key_budget_threshold to the holder
    And it carries key_name, virtual_key_id, organization_id, key_budget and key_spend as numbers, budget_reached, on_breach, window, scope_type and budget_period_end
    And budget_reached is true only for the breach

  @unit
  Scenario: A monthly budget anchored on the 31st sends gateway's period end
    Given a monthly budget anchored on the 31st whose period started on 28 February
    When gateway records its crossing with the period end it computed
    Then budget_period_end is 31 March as an ISO-8601 UTC string
    And a TOTAL budget's crossing sends budget_period_end null

  @unit
  Scenario: A threshold crossing names the model the key spent most on
    Given a copied USER key whose holder is a current member
    And gateway's crossing names gpt-5-mini with 0.62 of the key's spend this period
    When the crossing is delivered, then its breach, and the crossing again
    Then each sends key_budget_threshold with key_top_model gpt-5-mini and key_top_model_share 62, a whole percent, beside every attribute sent before
    And the redelivered crossing sends nothing more
    And an even split sends gateway's model at 50

  @unit
  Scenario: A crossing that names no top model sends no top-model properties
    Given a crossing whose top-model read failed in gateway, or one stored before gateway named a top model
    When it is delivered
    Then key_budget_threshold carries every attribute sent before
    And neither key_top_model nor key_top_model_share is sent, not even as null

  @unit
  Scenario: A crossing of an organization, project or team budget sends nothing
    Given a budget crossing that names no key
    When it is delivered
    Then Customer.io receives no call

  @unit
  Scenario: A crossing of a budget attributed per end user sends nothing
    Given a budget attributed to a copied key, one bucket per end user
    When one end user's bucket crosses
    Then Customer.io receives no call, the spend being that end user's and not the key's

  @unit
  Scenario: A crossing for a key nurturing never copied sends nothing and warns
    Given a crossing naming a key nurturing holds no copy of, no fact of it being left in gateway's log
    When it is delivered
    Then Customer.io receives no call
    And a warning is logged

  @unit
  Scenario: The key's holder hears it first, then its creator, then the organization's admin
    Given a key whose holder and creator are each a current member, a disabled member or no member at all
    When its creation or its budget's crossing is delivered
    Then the holder hears it when a current member
    And otherwise the creator when a current member
    And otherwise the organization's copied admin when a current member
    And otherwise no one, logged at debug level

  @unit
  Scenario: CONNECT and LANGY keys send nothing
    Given a key gateway created for a Connect licence or for Langy
    When its creation or its budget's crossing is delivered
    Then Customer.io receives no call

  @unit
  Scenario: A refused Customer.io call is retried without repeating the call that went
    Given Customer.io takes the identify and refuses the track of a created key
    When the fact is delivered
    Then the delivery fails so its job is retried
    And the retry sends the track and no second identify

  @unit
  Scenario: A retry that picks another recipient identifies them too
    Given Customer.io took the holder's identify and refused the track of a created key
    And the holder is then disabled while the creator is a current member
    When the fact is retried
    Then the creator is identified with has_virtual_key and tracked virtual_key_created

  @unit
  Scenario: The same fact delivered twice sends each call once
    Given a created key and a budget crossing
    When each fact is delivered twice
    Then the creation sends one identify and one track, and the crossing one track

  @integration
  Scenario: The same fact delivered twice sends each call once over Redis claims
    Given nurturing's delivery claims in Redis
    When a created key's fact and a crossing are each delivered twice
    Then the creation sends one identify and one track, and the crossing one track

  @unit
  Scenario: An erased person's key falls to the organization's admin
    Given a copied key whose holder and creator is a person who is then erased
    When gateway records a crossing of its budget
    Then the key copy names neither of them
    And key_budget_threshold goes to the organization's admin

  @integration
  Scenario: An erased person is cleared from every key copy in Postgres
    Given key copies in two organizations naming one person as holder or creator
    When that person is erased, twice
    Then no key copy names them, and a redelivered older fact naming them writes nothing back

  @integration
  Scenario: A fact stamped before an erasure never names the erased holder again
    Given nurturing's key copy in Postgres naming a person as holder, stamped T1
    When that person is erased, then a fact naming them stamped T2 lands, T1 < T2 < the erasure
    Then the key copy still names no holder

  @integration
  Scenario: A key is created for an erased person after their erasure
    Given a person was erased
    When a gateway "key created" fact naming them, stamped before the erasure, arrives
    Then the key copy stores no id for them

  @integration
  Scenario: A holder change for an erased person arrives late on a key with no holder
    Given a person was erased
    And a key copy has no holder yet
    When a holder fact naming them, stamped before the erasure, arrives
    Then the key copy stores no id for them

  @integration
  Scenario: A late created fact never names an erased creator
    Given a key copy folded from a later fact, so with no creator yet
    And a person was erased
    When the key's "key created" fact naming them as creator, stamped before the erasure, arrives
    Then the key copy records the creation and stores no id for them

  @integration
  Scenario: A late fact naming an erased person ends the key with no holder, as if it landed first
    Given a key copy whose holder is another person, stamped T1
    And a person was erased
    When a holder fact naming the erased person, stamped T2 > T1, arrives
    Then the key copy names no holder, stamped T2, as when that fact landed before the erasure
    And a fact naming the other person, stamped before T2, does not make them holder again

  @integration
  Scenario: A fact that lands while an erasure is committing still leaves the erased person off the key
    Given key copies naming a person as holder on one and as creator on another
    And that person's erasure mark has committed but its clearing of the key copies has not run
    When a fact naming them as holder or creator is folded in
    Then neither key copy names them
    And the cleared holder keeps their stamp, as erasure's own clearing leaves it

  @integration
  Scenario: A key fact naming a marked person stores them nowhere even if its re-check never runs
    Given a person's erasure mark is in Postgres
    When a created fact naming them as holder and creator is written and its worker stops before the re-check
    Then the write fails, and the key copy names no holder and no creator

  @integration
  Scenario: A holder change to another person, stamped before an erasure, still lands after it
    Given a key copy whose holder is a person, stamped T1
    And that person was erased
    When a holder fact naming another person, stamped T2 > T1, arrives
    Then the key copy names the other person as holder, stamped T2, as when it landed before the erasure

  @unit @integration
  Scenario: Two holder facts at one stamp, one naming an erased person, end the same in either order
    Given a person was erased
    When two holder facts stamped T, one naming them and one naming another person, arrive in either order
    Then the key copy names the other person as holder, stamped T
    And the key copy's lane has no batch write, which would fold the two in memory

  @unit
  Scenario: A key created before the copy existed is copied at deploy from gateway's log
    Given gateway's log holds a key's facts and nurturing holds no copy of it
    When the deploy steps run
    Then the key copy equals the one live delivery of the same facts would have left

  @unit
  Scenario: A key with no created fact in the log is copied with no creation time
    Given gateway's log holds a key's rotated fact and no created fact
    When the deploy steps run
    Then the key copy names no creation time

  @unit
  Scenario: A fact naming another organization changes no copied key
    Given a copied key and a later fact for it naming another organization
    When the deploy steps run
    Then the key copy is as the first organization's facts left it

  @unit
  Scenario: Replaying the key copy twice leaves every row as it was
    Given the deploy steps have run
    When the key copy's step runs again, trailing pass included
    Then every row is byte-identical

  @unit
  Scenario: The deploy replay stores no person erased before the copy existed
    Given user's log and identity's log each hold a person's erasure, and no mark exists
    And gateway's log names both as creator or holder
    When the deploy steps run in their declared order
    Then both people are marked and the key copy names neither
    And the key step is declared after both marks steps
    And a key step run first would store them, and a marks step run after it clears them
    And a marks step whose write fails fails the step

  @unit
  Scenario: A resumed replay stores no erased person and moves no stamp back
    Given the marks steps and the key step have run
    When the key step runs again from its own report
    Then the rows are as they were and name no erased person

  @unit @integration
  Scenario: A key whose facts sit under two tenants ends the same in either tenant order
    Given a key's created fact under one event tenant and its later fact under another
    When they arrive in either tenant order, live or by replay
    Then the key copy equals the one per-fact delivery leaves

  @unit
  Scenario: A person erased during the deploy replay is on no key after it
    Given the key step is replaying facts naming a person
    When their erasure commits between two writes
    Then no key copy names them when the step ends

  @unit
  Scenario: A key fact delivered during the cutover is in the copy after the trailing pass
    Given a fact lands in gateway's log after the first pass discovered its aggregates
    When the key step finishes
    Then the key copy holds that fact, the trailing pass having replayed from the first pass's cursor

  @unit
  Scenario: A failed key write fails the replay step, which resumes and fills the key on its next run
    Given the key copy's write fails
    When the key step runs
    Then the step fails
    And its next run, the write healthy again, fills the key

  @unit
  Scenario: A key fact the contract refuses fails the replay and the live lane alike
    Given a key fact whose data gateway's contract refuses
    When the key step runs, or the live lane maps it
    Then both fail, the live job blocking its group rather than being dead-lettered

  @unit
  Scenario: The key copy's replay step names the lane the usage pipeline declares
    Given the module's replay steps
    When each runs dry
    Then each resolves a lane of the usage pipeline, and the subscriber's old lane name is refused as unknown

  @unit
  Scenario: A key fact naming an erased person sends nothing to them
    Given a person was erased
    And organization's fact that they accepted an invitation, stamped before the erasure, lands after it
    When gateway's created fact naming them as holder and creator is delivered
    Then nurturing's member copy holds no row for them
    And no identify or track goes to them, for the join or for the key
    And virtual_key_created goes to the organization's admin
    And no warning says a holder was passed over for a lagging member copy

  @unit
  Scenario: A key fact naming a marked holder whose member row survived goes to the admin
    Given a person is marked erased but still holds a current member row
    When gateway's created fact naming them as holder and creator is delivered
    Then virtual_key_created goes to the organization's admin
    And no identify or track goes to them

  @integration
  Scenario: Which people are erased is read from the erasure marks in Postgres
    Given two people's erasures were recorded in Postgres, one of them twice
    When nurturing asks which of 2,500 people, those two among them, are erased
    Then it names only the two erased people, each once, reading at most 1,000 ids at a time

  @unit
  Scenario: A key's first request sets has_app_request on the person told of the key
    Given a copied USER key whose holder is a current member
    When gateway records the key's first request
    Then Customer.io identifies the holder with has_app_request true
    And no track is sent
    And no further request on the key sends anything, gateway recording the first only

  @unit
  Scenario: A key's first request is told to whoever its creation was told to
    Given a copied USER key whose holder and creator are each a current member, a disabled member or no member at all
    When gateway records the key's first request
    Then has_app_request goes to the holder, else the creator, else the organization's admin, as virtual_key_created did
    And no one is identified when none of them is a current member

  @unit
  Scenario: A first request on a key nurturing does not tell of sends nothing
    Given a CONNECT or LANGY key, or a revoked or disabled key
    When gateway records the key's first request
    Then Customer.io receives no call

  @unit
  Scenario: A first request before the key's copy is retried until the copy lands
    Given a current member's USER key whose first request arrives before nurturing copies the key
    When the first-request fact is delivered
    Then the delivery fails so its job is retried, gateway recording a key's first request only once
    And once the copy lands, the retry identifies the holder with has_app_request true

  @unit
  Scenario: A first request on a key nurturing never copies ends unsent after its retries
    Given a key whose lifecycle copy never reached nurturing, such as a lost or failed copy
    When its first-request fact is delivered and retried
    Then each delivery before the last of its bounded attempts fails so its job is retried
    And the last attempt sends nothing and logs an error, so the job ends instead of looping

  @unit
  Scenario: A first request with no delivery attempt counts as the first and is retried
    Given a current member's USER key whose first request arrives before nurturing copies the key
    When the first-request fact is delivered with no delivery attempt
    Then the delivery fails as the first attempt, so its job is retried and sends nothing

  @unit
  Scenario: A key's first request delivered twice identifies once
    Given a copied USER key's first-request fact
    When it is delivered twice
    Then Customer.io receives one has_app_request identify

  @unit
  Scenario: A refused has_app_request identify is retried
    Given Customer.io refuses the first has_app_request identify
    When the fact is delivered, then retried
    Then the first delivery fails so its job is retried
    And the retry sends the identify once

  @integration
  Scenario: A key's first request delivered twice identifies once over Redis claims
    Given nurturing's delivery claims in Redis
    When a key's first-request fact is delivered twice
    Then Customer.io receives one has_app_request identify

  @unit
  Scenario: Unbudgeted spend sends gateway_spend_without_budget to the organization's admin
    Given gateway records that an organization's person keys spent without a budget this week
    When the fact is delivered
    Then Customer.io tracks one gateway_spend_without_budget to the organization's admin
    And it carries keys (name and spend of at most five), key_count, total_spend and organization_id, and no key id
    And each spend and total_spend is a number rounded to cents
    And its message id is "<organization>:unbudgeted:<ISO week>"

  @unit
  Scenario: Unbudgeted spend with no admin to tell sends nothing
    Given the organization's copied admin is no current member, or it has no copied admin
    When gateway's unbudgeted-spend fact is delivered
    Then Customer.io receives no call
    And the dropped fact is logged at debug level

  @unit
  Scenario: Unbudgeted spend delivered twice tracks once
    Given an organization's unbudgeted-spend fact for one ISO week
    When it is delivered twice
    Then Customer.io receives one gateway_spend_without_budget
    And the next week's fact sends again

  @unit
  Scenario: Two sweeps' facts in one ISO week send once
    Given gateway records an organization's unbudgeted spend on two sweeps of one ISO week, with different spend and instants
    When both facts are delivered
    Then Customer.io receives one gateway_spend_without_budget, with the first fact's figures

  @integration
  Scenario: Unbudgeted spend delivered twice tracks once over Redis claims
    Given nurturing's delivery claims in Redis
    When an organization's unbudgeted-spend fact is delivered twice
    Then Customer.io receives one gateway_spend_without_budget

  # --- AC Coverage Map (gateway_spend_without_budget) ---
  # "budgeted keys left out, $5 edge, top 5"     -> gateway's gateway-governance-events.feature
  # "one track with the template's payload"      -> Scenario: Unbudgeted spend sends gateway_spend_without_budget to the organization's admin
  # "no admin, no send"                          -> Scenario: Unbudgeted spend with no admin to tell sends nothing
  # "redelivery once, memory and Redis"          -> Scenario: Unbudgeted spend delivered twice tracks once
  #                                               -> Scenario: Unbudgeted spend delivered twice tracks once over Redis claims
  # "at most weekly per organization"            -> Scenario: Two sweeps' facts in one ISO week send once
  # "replay never sends"                         -> eventing/__tests__/nurturing-replay.no-send.unit.test.ts

  # --- AC Coverage Map (key_top_model) ---
  # AC 1: "62% on gpt-5-mini, every property"        -> Scenario: A threshold crossing names the model the key spent most on
  # AC 2: "breach carries the figures"           -> Scenario: A threshold crossing names the model the key spent most on
  # AC 3: "delivered twice, one track"           -> Scenario: A threshold crossing names the model the key spent most on
  # AC 4: "50/50: first by name, 50"             -> Scenario: A threshold crossing names the model the key spent most on
  #                                               -> gateway's gateway-governance-events.feature (the tie)
  # AC 5: "model read fails: no properties"      -> Scenario: A crossing that names no top model sends no top-model properties
  #                                               -> gateway's gateway-governance-events.feature (the failed read)
  # AC 6: "stored before: as today"              -> Scenario: A crossing that names no top model sends no top-model properties
  # AC 7: "keyless crossings send nothing"       -> Scenario: A crossing of an organization, project or team budget sends nothing
  # AC 8: "one by-model read per crossing"       -> gateway's gateway-governance-events.feature

  # --- AC Coverage Map (has_app_request) ---
  # "one identify, no track"                     -> Scenario: A key's first request sets has_app_request on the person told of the key
  # "same recipient as virtual_key_created"      -> Scenario: A key's first request is told to whoever its creation was told to
  # "Connect, Langy, revoked, disabled"          -> Scenario: A first request on a key nurturing does not tell of sends nothing
  # "copy not yet landed retries"                -> Scenario: A first request before the key's copy is retried until the copy lands
  # "never-copied key ends, bounded"             -> Scenario: A first request on a key nurturing never copies ends unsent after its retries
  # "redelivery once, memory and Redis"          -> Scenario: A key's first request delivered twice identifies once
  #                                               -> Scenario: A key's first request delivered twice identifies once over Redis claims
  # "refused call retries"                       -> Scenario: A refused has_app_request identify is retried
  # "first request only, racing batches once"    -> gateway's gateway-governance-events.feature
  # "replay never sends"                         -> eventing/__tests__/nurturing-replay.no-send.unit.test.ts

  # --- AC Coverage Map (langwatch/tasks#1200) ---
  # AC 1: "null purpose counts as USER"          -> unit only: nurturing-virtual-key.rules.unit.test.ts
  # AC 2: "CONNECT and LANGY send nothing"       -> Scenario: CONNECT and LANGY keys send nothing
  # AC 3: "membership test, both ids, disabled"  -> Scenario: The key's holder hears it first, then its creator, then the organization's admin
  # AC 4: "recipient chain, debug when none"     -> Scenario: The key's holder hears it first, then its creator, then the organization's admin
  # AC 5: "create paths fill the three fields"   -> unit only: gateway's gateway-governance-events.create-paths.unit.test.ts
  # AC 6: "old facts parse; missing period end"  -> unit only: gateway's gateway.governance-events.unit.test.ts, nurturing-gateway-facts.rules.unit.test.ts
  # AC 7: "key created: identify and track"      -> Scenario: A created person's key sets has_virtual_key and sends virtual_key_created
  #                                               -> Scenario: An admin told of a key not theirs is not given has_virtual_key
  # AC 8: "trait stays true"                     -> Scenario: has_virtual_key stays true after the person's last key is revoked
  # AC 9: "other actions send nothing; fold"     -> Scenario: Rotating, disabling, enabling or revoking a key sends nothing and updates the key copy
  #                                               -> Scenario: The key copy folds every lifecycle fact order-free in Postgres
  # AC 10: "revoked or disabled: no crossing"    -> Scenario: A crossing for a revoked or disabled key sends nothing
  # AC 11: "key_budget_threshold attributes"     -> Scenario: A threshold crossing sends key_budget_threshold with every attribute
  #                                               -> Scenario: A monthly budget anchored on the 31st sends gateway's period end
  # AC 12: "scope without a key"                 -> Scenario: A crossing of an organization, project or team budget sends nothing
  #                                               -> Scenario: A crossing of a budget attributed per end user sends nothing
  # AC 13: "uncopied key warns"                  -> Scenario: A crossing for a key nurturing never copied sends nothing and warns
  # Key copy as a peer map (PR 9649): the scenarios from "A key created before the copy existed" to
  #   "The key copy's replay step names the lane" -> eventing/__tests__/nurturing-virtual-keys.replay.unit.test.ts
  # AC 14: "crossing recipient chain"            -> Scenario: The key's holder hears it first, then its creator, then the organization's admin
  # AC 15: "failure retries, no second success"  -> Scenario: A refused Customer.io call is retried without repeating the call that went
  #                                               -> Scenario: A retry that picks another recipient identifies them too
  # AC 16: "idempotency, memory and Redis"       -> Scenario: The same fact delivered twice sends each call once
  #                                               -> Scenario: The same fact delivered twice sends each call once over Redis claims
  # AC 17: "erasure falls to the admin"          -> Scenario: An erased person's key falls to the organization's admin
  #                                               -> Scenario: An erased person is cleared from every key copy in Postgres
  #                                               -> Scenario: A fact stamped before an erasure never names the erased holder again
  # AC 18: "forbidden fields in payloads"        -> unit only: nurturing.pipeline.gateway-facts.unit.test.ts greps every captured request
  # AC 19: "webhook envelope test unchanged"     -> unit only: the file is not in the diff
  # AC 20: "ADR-001 and READMEs"                 -> adrs/001-nurturing-package-boundary.md; READMEs from CI's printed diff
  #
  # --- AC Coverage Map (langwatch/tasks#1204) ---
  # "key created after the erasure"              -> Scenario: A key is created for an erased person after their erasure
  # "late holder on a key with no holder"        -> Scenario: A holder change for an erased person arrives late on a key with no holder
  # "late created fact" (issue's Actual list)    -> Scenario: A late created fact never names an erased creator
  # "erased holder null in any order"            -> Scenario: A late fact naming an erased person ends the key with no holder, as if it landed first
  # "fact racing the erasure's commit"           -> Scenario: A fact that lands while an erasure is committing still leaves the erased person off the key
  # "no send to an erased person"                -> Scenario: A key fact naming an erased person sends nothing to them
  #                                               -> Scenario: A key fact naming a marked holder whose member row survived goes to the admin
  #                                               -> Scenario: Which people are erased is read from the erasure marks in Postgres
  #                                               -> Scenario: A member fact landing after an erasure writes no member row in Postgres (project-usage.feature)
  #                                               -> Scenario: A member fact landing while an erasure commits leaves no member row in Postgres (project-usage.feature)
  # "hand-over after erasure kept"               -> Scenario: A holder change to another person, stamped before an erasure, still lands after it
