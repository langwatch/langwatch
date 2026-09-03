export class ScopeTargetNotFoundError extends Error {
  name = "ScopeTargetNotFoundError" as const;
  constructor(message = "Scope target not found.") {
    super(message);
  }
}
export class InvalidDataPrivacyConfigError extends Error {
  name = "InvalidDataPrivacyConfigError" as const;
  constructor(message: string) {
    super(message);
  }
}

export class DepartmentScopeOwnershipUnavailableError extends Error {
  name = "DepartmentScopeOwnershipUnavailableError" as const;
  constructor() {
    super(
      "Department data-privacy scopes require the canonical department service before they can be changed.",
    );
  }
}
