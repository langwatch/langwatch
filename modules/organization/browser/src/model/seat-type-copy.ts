/**
 * What an admin is told when choosing a seat. The Developer seat (ADR-171) is
 * a login with a personal project and nothing shared: not a cheaper full seat
 * and not a viewing seat.
 */
export const SEAT_TYPE_COPY = {
  liteMemberShortDescription: "Can view the work, but not change it",
  liteMemberExplanation:
    "A lite member can open the projects they are invited to and read what the " +
    "team produces there: traces, analytics, evaluations, scenario runs, " +
    "datasets, prompts and experiments. They can leave annotations, and that is " +
    "the only thing they can change. They cannot see costs, and they cannot " +
    "create, edit or delete anything else. The same limits apply wherever they " +
    "reach the data, including the API and the MCP server. Give someone " +
    "permission to change something and they hold a full seat instead.",
  liteMemberNeedsTeamWarning:
    "Add a team, or this person will not see anything. A lite member reaches " +
    "only the projects their teams give them, so one with no team can sign in " +
    "and do no more. You can add a team later from the members list.",
  developerSeatsLabel: "Developers",
  developerShortDescription: "Works in a project of their own, sees nothing shared",
  developerExplanation:
    "A developer gets a personal project and everything a member can do inside " +
    "it: send traces from the CLI, run queries and evaluations, manage its keys. " +
    "They cannot open or be added to any shared project or team, and they are " +
    "never counted against your member seats. Move them to a Member seat if " +
    "they need shared projects.",
  seatTypesDocPath: "/ai-governance/roles-and-permissions#seats",
};
