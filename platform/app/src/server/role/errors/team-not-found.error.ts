export class TeamNotFoundError extends Error {
  constructor(message = "Team not found") {
    super(message);
    this.name = "TeamNotFoundError";
  }
}
