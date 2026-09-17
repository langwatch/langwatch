Feature: Feature web packages do not republish design-system components
  Generic UI components have one public owner so feature packages do not create
  cross-module dependencies for presentation code the feature does not own.

  Rule: A feature web export cannot duplicate a design-system component

    @unit
    Scenario: A feature web package cannot republish a design-system component
      Given a component exported by the design system
      When a feature web package exports a component with the same runtime name
      Then the feature export is refused with the canonical design-system import
