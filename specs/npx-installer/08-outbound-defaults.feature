Feature: An npx install makes no outbound calls beyond license sync and usage report by default
  As an operator running `npx @langwatch/server`
  I want the same outbound defaults the Docker images and the Helm chart carry
  So that the install does not call third parties unless I opt in

  @unit
  Scenario: The app, the workers and the migrations turn off Prisma's version check
    When the launcher starts the app, the workers or the migrations
    Then the process env carries "CHECKPOINT_DISABLE=1"

  @unit
  Scenario: Prisma's version check stays off whatever the user's .env says
    Given the user's .env sets CHECKPOINT_DISABLE to "0"
    When the launcher starts the app, the workers or the migrations
    Then the process env carries "CHECKPOINT_DISABLE=1"

  @unit
  Scenario: The app and the workers read tokenizer files from disk
    When the launcher starts the app or the workers
    Then the process env points TIKTOKENS_PATH at the launcher's tokenizer cache

  @unit
  Scenario: LangEvals prices from the LangWatch catalog and tokenizes from a local cache
    When the launcher starts LangEvals
    Then the process env points LANGWATCH_MODEL_PRICING_DIR at the app's model catalog
    And TIKTOKEN_CACHE_DIR and CUSTOM_TIKTOKEN_CACHE_DIR point at the launcher's tokenizer cache
    And RAGAS analytics are off

  @unit
  Scenario: A value in the user's .env overrides a default
    Given the user's .env sets TIKTOKENS_PATH or RAGAS_DO_NOT_TRACK
    When the launcher starts the service
    Then the process env carries the user's value

  @unit
  Scenario: The tokenizer files are downloaded once at install time
    Given the tokenizer cache holds every file tiktoken's registry names
    When the install step runs
    Then nothing is downloaded

  @unit
  Scenario: A missing tokenizer file is downloaded at install time
    Given the tokenizer cache misses a file tiktoken's registry names
    When the install step runs
    Then the app's download script fills the cache

  @unit
  Scenario: LangEvals' tokenizer cache is filled once per lockfile
    Given LangEvals' tokenizer cache was filled for the current lockfile
    When the install step runs
    Then the cache is not filled again
