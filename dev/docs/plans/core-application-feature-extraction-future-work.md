# Core application extraction follow-up work

This file records worthwhile structural work that is deliberately outside the
behaviour-preserving `platform/app` extraction. It is not an excuse to leave an
old implementation behind, and none of these items blocks its owning migration
batch.

## Agent testing web composition

`platform/app/src/components/agent-testing` currently composes Scenario,
Prompt, Agent and Suite behaviour in the same browser modules. In particular,
run-dialog, case-editor and plan-editor files often fetch or transform several
of those domains together.

During extraction, move reusable browser behaviour to the existing owning
feature web packages and leave only route/page composition in `apps/ui`. Keep
the present behaviour and transport shapes; do not redesign this surface as
part of the Suite/Scenario server cut.

After the physical move, inventory the remaining mixed modules and separate
them around named browser responsibilities:

- Scenario case editing, version selection and run parameters;
- Agent and Prompt target selection;
- Suite plan editing, scope and run results; and
- the small `apps/ui` composition layer that joins those surfaces.

Do not replace the current mixture with a giant shared context or injected
tRPC hooks. Feature web packages should receive controlled data and actions,
or a small named render port when composition genuinely crosses owners.
