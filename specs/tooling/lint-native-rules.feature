# ADR-135 records these oxlint built-ins. They are enabled in the top-level
# `rules` block of `.oxlintrc.jsonc`; the scoped natives live in `overrides`
# and are listed in the ADR, not here.

Feature: The oxlint built-ins the repository enables workspace-wide
  As a platform maintainer
  I want every built-in the root config enables to be stated in one place
  So that a native rule cannot be switched on or off without a trace

  Rule: `no-empty`, `no-nested-ternary`, `typescript/array-type`, `typescript/consistent-type-imports`, `unicorn/no-array-sort` and `node/no-process-env` hold the core shapes

    @unit
    Scenario: The core built-ins are enabled workspace-wide at error
      Given the root oxlint configuration
      When its workspace-wide rules are read
      Then no-empty, no-nested-ternary, typescript/array-type, typescript/consistent-type-imports, unicorn/no-array-sort and node/no-process-env are each at error

  Rule: `import/no-cycle`, `import/export`, `import/no-self-import`, `import/no-empty-named-blocks`, `import/no-absolute-path`, `import/no-mutable-exports` and `import/no-duplicates` keep the import graph honest

    @unit
    Scenario: The import built-ins are enabled workspace-wide at error
      Given the root oxlint configuration
      When its workspace-wide rules are read
      Then every import rule the ADR lists is at error

  Rule: `promise/no-multiple-resolved`, `promise/catch-or-return` and `promise/no-return-wrap` keep a promise settled once and handled

    @unit
    Scenario: The promise built-ins are enabled workspace-wide at error
      Given the root oxlint configuration
      When its workspace-wide rules are read
      Then every promise rule the ADR lists is at error

  Rule: `jsx-a11y/no-autofocus`, `jsx-a11y/no-static-element-interactions`, `jsx-a11y/click-events-have-key-events`, `jsx-a11y/aria-role`, `jsx-a11y/media-has-caption`, `jsx-a11y/mouse-events-have-key-events`, `jsx-a11y/role-supports-aria-props`, `jsx-a11y/no-noninteractive-tabindex`, `jsx-a11y/img-redundant-alt` and `jsx-a11y/autocomplete-valid` keep the interface usable without a mouse

    @unit
    Scenario: The accessibility built-ins are enabled workspace-wide at error
      Given the root oxlint configuration
      When its workspace-wide rules are read
      Then every jsx-a11y rule the ADR lists is at error

  Rule: `vitest/valid-expect`, `vitest/valid-title` and `vitest/require-mock-type-parameters` are set by name

    @unit
    Scenario: The vitest built-ins carry the settings ADR-142 records
      Given the root oxlint configuration
      When its workspace-wide rules are read
      Then vitest/valid-expect and vitest/valid-title are at error
      And vitest/require-mock-type-parameters is off
