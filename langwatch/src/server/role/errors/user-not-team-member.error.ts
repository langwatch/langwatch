export class UserNotTeamMemberError extends Error {
  constructor(message = "User is not a member of the specified team") {
    super(message);
    this.name = "UserNotTeamMemberError";
  }
}
