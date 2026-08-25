/**
 * What an admin is told when choosing between a full and a lite seat.
 *
 * Seats are the one thing a paid plan still meters, so this is a billing
 * question, and admins were asking their account manager instead of reading
 * the form. The line to hold: a seat type follows from what the person can
 * do, not from a switch someone flips. Someone who can only look at what the
 * team produces holds a lite seat; the moment they can change something they
 * hold a full one, and a custom role granting anything beyond viewing moves
 * them across on its own (`classifyMemberType`).
 *
 * The short description stays scannable and the boundary goes behind the (i),
 * per `dev/docs/best_practices/copywriting.md`. The list is pinned by
 * `seatTypeCopy.unit.test.ts` so it cannot drift from
 * `EXTERNAL_MEMBER_PERMISSIONS` unnoticed.
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

export const SEAT_TYPES_DOC_PATH = "/ai-governance/roles-and-permissions#seats";
