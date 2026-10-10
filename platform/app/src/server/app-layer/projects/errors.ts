import { HandledError } from "@langwatch/handled-error";

/**
 * A write was aimed at an aggregate project (ADR-144 decision 8). An
 * aggregate is read only in v1: it owns no traces, prompts, datasets or
 * experiments of its own, so anything written under it would belong to no
 * one. The data it shows lives on its member projects, and that is where a
 * change is made.
 */
export class AggregateProjectIsReadOnlyError extends HandledError {
  declare readonly code: "aggregate_project_is_read_only";

  constructor() {
    super(
      "aggregate_project_is_read_only",
      "This project reads traces from other projects, so no data can be added to it",
      // Forbidden, like the aggregate's other refusals: the request is well
      // formed, the project does not take it.
      { httpStatus: 403, fault: "customer" },
    );
    this.name = "AggregateProjectIsReadOnlyError";
  }
}

/**
 * Someone who is not an organisation admin asked to create an aggregate or
 * edit its rule (ADR-144 decision 5). An aggregate reads other people's
 * personal projects, so opening one is decided on the organisation role
 * alone, and whoever creates one has to be able to open it.
 */
export class AggregateProjectAdminOnlyError extends HandledError {
  declare readonly code: "aggregate_project_admin_only";

  constructor() {
    super(
      "aggregate_project_admin_only",
      "Only organization admins can open an aggregate project",
      { httpStatus: 403, fault: "customer" },
    );
    this.name = "AggregateProjectAdminOnlyError";
  }
}

/**
 * A rule named a project or a department this organisation does not own, or
 * one an aggregate cannot read (the hidden governance project, another
 * aggregate). Raised before anything is written, so a refused rule leaves no
 * project and no grant behind.
 *
 * One code for every case on purpose: telling "belongs to another
 * organisation" apart from "does not exist" would confirm to the caller that
 * an id they guessed is real somewhere else.
 */
export class AggregateRuleOutsideOrganizationError extends HandledError {
  declare readonly code: "aggregate_rule_outside_organization";

  constructor() {
    super(
      "aggregate_rule_outside_organization",
      "The rule names a project or department outside this organization",
      { httpStatus: 400 },
    );
    this.name = "AggregateRuleOutsideOrganizationError";
  }
}
