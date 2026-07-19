export class RoleDuplicateNameError extends Error {
  constructor(message = "A role with this name already exists") {
    super(message);
    this.name = "RoleDuplicateNameError";
  }
}
