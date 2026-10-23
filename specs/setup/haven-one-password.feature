Feature: haven resolves development secrets from 1Password
  As a developer keeping every credential in 1Password
  I want haven to read the LangWatch item once and hand its values to every process it starts
  So that the root .env holds only config and no service needs a credential line in it

  # ADR-132 amendment 2026-10-23; ARCHITECTURE.md §6. Order is unchanged: the
  # shell, then .env, then the item Private/LangWatch when LANGWATCH_OP_ACCOUNT is set.

  @unit
  Scenario: A key only 1Password holds counts as configured
    Given LANGWATCH_OP_ACCOUNT is set and the item holds STRIPE_SECRET_KEY
    And neither the shell nor .env sets it
    When haven resolves the development environment
    Then STRIPE_SECRET_KEY is answered from the item
    And paymentsim is not pointed at billing

  @unit
  Scenario: The shell and .env still win over the item
    Given the item holds a key that .env also sets
    When haven resolves the development environment
    Then the .env value answers and the item's value is not injected

  @unit
  Scenario: The item is read once with one op call
    Given LANGWATCH_OP_ACCOUNT is set and op is signed in
    When haven resolves the environment several times in one run
    Then op is called once

  @unit
  Scenario: A locked or missing op leaves the stack as it was
    Given LANGWATCH_OP_ACCOUNT is set and op fails or is not on the path
    When haven resolves the development environment
    Then one warning names the reason and no value comes from 1Password
    And the children keep LANGWATCH_OP_ACCOUNT so the Node chain may try itself

  @unit
  Scenario: Every process haven starts gets the item's values
    Given haven read the item
    When haven plans the stack's processes
    Then each process's environment carries the item's fields the shell and .env leave unset
    And LANGWATCH_OP_ACCOUNT is blank there, so no process asks 1Password a second time
    And the stack's own addresses win over a field of the same name

  @unit
  Scenario: The move is a dry run until it is applied
    Given .env holds credential lines and config lines
    When the developer runs haven secrets move
    Then haven lists the credential keys by name and writes nothing
    And no value appears in the output

  @unit
  Scenario: Applying the move fills the item, then rewrites .env
    Given .env holds credential lines and the account is named
    When the developer runs haven secrets move --apply
    Then the values reach op on standard input as an item template, never as an argument
    And the item is created when missing, or edited keeping its other fields
    And once the item reads back with every value, the moved lines leave .env
    And LANGWATCH_OP_ACCOUNT is set in .env and every config line is untouched

  @unit
  Scenario: A connection string without a password is config
    Given .env sets a database URL that carries no password
    When haven classifies the .env lines
    Then the URL stays in .env and is not reported as a credential

  @unit
  Scenario: A credential back in .env is named at haven up
    Given .env holds a credential line
    When the developer runs haven up
    Then one warning names the key, never its value, and points at haven secrets move
