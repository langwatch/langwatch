Feature: Customer.io hears when a person's gateway key is created and when its budget nears or hits its limit
  Gateway records a key's lifecycle and its budget's crossings as its own facts. Nurturing copies
  each key from the lifecycle facts and reads only its own copies (ADR-001): the key's name, the
  person it acts for, the person who created it, its purpose and its state. One person hears each
  fact: the key's holder if they are a current member of its organization, else its creator if
  they are, else the organization's admin if they are, else no one. Connect and Langy keys send
  nothing. A key no person holds or made goes to the organization's admin.

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
    Given a crossing naming a key nurturing holds no copy of
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
  # AC 14: "crossing recipient chain"            -> Scenario: The key's holder hears it first, then its creator, then the organization's admin
  # AC 15: "failure retries, no second success"  -> Scenario: A refused Customer.io call is retried without repeating the call that went
  # AC 16: "idempotency, memory and Redis"       -> Scenario: The same fact delivered twice sends each call once
  #                                               -> Scenario: The same fact delivered twice sends each call once over Redis claims
  # AC 17: "erasure falls to the admin"          -> Scenario: An erased person's key falls to the organization's admin
  #                                               -> Scenario: An erased person is cleared from every key copy in Postgres
  # AC 18: "forbidden fields in payloads"        -> unit only: nurturing.pipeline.gateway-facts.unit.test.ts greps every captured request
  # AC 19: "webhook envelope test unchanged"     -> unit only: the file is not in the diff
  # AC 20: "ADR-001 and READMEs"                 -> adrs/001-nurturing-package-boundary.md; READMEs from CI's printed diff
