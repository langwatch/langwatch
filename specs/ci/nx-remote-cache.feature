@ci @unit
Feature: Nx remote cache shared by CI and laptops
  Nx task results live in a private S3 bucket in the dev AWS account, so a
  pull request replays what a laptop or an earlier push already built, and the
  run on main after a merge replays what the pull request ran. Who may write
  where decides who main trusts: main trusts only entries CI wrote. CI uses
  its OIDC roles; a laptop uses its GitHub login through the cache gate.

  Scenario: Main reads and writes only CI namespaces
    Given a CI run on a push to main
    When the cache scope is resolved
    Then it reads main/ and then pr/
    And it writes main/
    And it never reads a branch/ namespace

  Scenario: A pull request writes pr/ and reads its own branch last
    Given a CI run for a pull request from branch feat/x
    When the cache scope is resolved
    Then it reads pr/, then main/, then branch/feat_x/
    And it writes pr/

  Scenario: A pull request that used a laptop entry stops writing pr/
    Given a pull request job has been served an entry from branch/feat_x/
    When it stores a new task result
    Then the result goes to branch/feat_x/, not pr/
    And every later job of that branch writes branch/feat_x/ too, since its restored caches can hold laptop output

  Scenario: A laptop writes only its own branch
    Given a laptop on branch feat/x signed in to GitHub
    When the cache scope is resolved
    Then it reads branch/feat_x/, then main/, then pr/
    And it writes branch/feat_x/

  Scenario: A laptop on main or a detached head only reads
    Given a laptop on main
    When the cache scope is resolved
    Then it writes nothing

  Scenario: Other CI events get no remote cache
    Given a CI run on a tag, a schedule, the merge queue, a manual run or a branch push other than main
    When the cache scope is resolved
    Then the remote cache is off

  Scenario: No GitHub login leaves Nx on its local cache
    Given a laptop with no GitHub login, a laptop with LANGWATCH_NX_REMOTE_CACHE=0, or a CI job whose role was not assumed
    When an Nx run starts
    Then the remote cache is off and the run behaves as before

  Scenario: A member's laptop reads every namespace and writes its branch through the gate
    Given a laptop on branch feat/x whose GitHub token belongs to a member of the langwatch org
    When Nx asks for an entry and stores one
    Then the laptop reads and writes S3 through URLs the cache gate signed, with no AWS credentials
    And one gate call signs every namespace the lookup tries
    And the new entry goes to branch/feat_x/ and is never replaced

  Scenario: A laptop outside the GitHub org reads main only
    Given a laptop whose GitHub token belongs to someone outside the langwatch org
    When Nx asks for entries and stores one
    Then it is served entries from main/ only
    And nothing it builds is uploaded

  Scenario: A token the gate refuses turns the cache off
    Given a GitHub token the gate refuses, expired or revoked
    When Nx asks for an entry
    Then the answer is a miss
    And the gate is not asked again for ten minutes

  Scenario: A gate that is down is a miss, never a failed run
    Given the cache gate does not answer
    When Nx asks for an entry or stores one
    Then a read answers not found and a write answers success

  Scenario: Dev tells a laptop with no GitHub login how to turn the cache on, and never waits
    Given pnpm dev or haven up starts on a laptop with no GitHub login
    When it starts
    Then it prints one line saying the cache is off and to run gh auth login
    And a person at a terminal is told once, an agent or a script every time
    And it never prompts or reads input, so dev starts at once

  Scenario: CI hands the role's credentials only to the cache server
    Given a CI job whose cache role was assumed
    When the nx-remote-cache action starts the server
    Then the server's environment holds PATH and the role's session, expiry included, and nothing else
    And no step gets AWS credentials
    And the job's environment gains only the Nx server URL and its access token

  Scenario: A worktree keeps one cache server per configuration
    Given a cache server already running for this worktree, branch, bucket and login
    When another Nx run starts
    Then it reuses that server
    And a state file left by a server that is gone is discarded, and its pid is never signalled

  Scenario: A cache server that does not start leaves Nx on its local cache
    Given a cache server that never answers its health check
    When an Nx run starts
    Then the launcher stops the process it started and Nx runs on its local cache

  Scenario: CI shows what the cache server saw
    Given a CI job that used the remote cache
    When the job ends
    Then the server's log is printed in the job
    And requests that failed raise one warning on the run

  Scenario: An S3 answer that is neither the object nor a missing key never reads as no taint
    Given a pull request job whose taint marker read gets an S3 error such as 500 or 503
    When it stores a new task result
    Then the result goes to its branch namespace, not pr/
    And a missing marker (404, or 403 since the roles cannot list the bucket) means no taint

  Scenario: An S3 failure is a miss, never a failed run
    Given the cache server cannot reach S3 or has no credentials
    When Nx asks for an entry or stores one
    Then a read answers not found and a write answers success
    And nothing reaches S3

  Scenario: An entry is never replaced
    Given an entry already stored under a hash
    When another run stores the same hash
    Then the stored entry stays as it was

  Scenario: Oversized entries are not uploaded
    Given a task result larger than the upload limit
    When Nx stores it
    Then nothing is uploaded and Nx is told it was stored

  Scenario: Requests are signed with AWS Signature Version 4
    Given AWS's published S3 GET example
    When the request is signed
    Then the signature matches AWS's
