/**
 * Domain error thrown when an agent cannot be found.
 * The route handler translates this to a 404 HTTP response.
 */
export class AgentNotFoundError extends Error {
  constructor(message = "Agent not found") {
    super(message);
    this.name = "AgentNotFoundError";
  }
}
