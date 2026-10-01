/** What an admin is told when choosing between a full and a lite seat. */
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
  seatTypesDocPath: "/ai-governance/roles-and-permissions#seats",
};
