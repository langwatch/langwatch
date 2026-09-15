/**
 * Admin guidance on seat types. A seat type follows from what the person can
 * do, not a switch. Read-only → lite seat; can change anything → full seat.
 */
export const LITE_MEMBER_SHORT_DESCRIPTION = "Can view the work, but not change it";

export const LITE_MEMBER_EXPLANATION =
  "A lite member can open the projects they are invited to and read what the " +
  "team produces there: traces, analytics, evaluations, scenario runs, " +
  "datasets, prompts and experiments. They can leave annotations, and that is " +
  "the only thing they can change. They cannot see costs, and they cannot " +
  "create, edit or delete anything else. The same limits apply wherever they " +
  "reach the data, including the API and the MCP server. Give someone " +
  "permission to change something and they hold a full seat instead.";

/**
 * Warning when inviting a lite member with no team. A lite seat carries no
 * organization-wide access, so no team means they sign in but see nothing.
 */
export const LITE_MEMBER_NEEDS_TEAM_WARNING =
  "Add a team, or this person will not see anything. A lite member reaches " +
  "only the projects their teams give them, so one with no team can sign in " +
  "and do no more. You can add a team later from the members list.";

export const SEAT_TYPES_DOC_PATH = "/ai-governance/roles-and-permissions#seats";
