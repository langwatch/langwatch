/**
 * Where a new account goes before it makes an organization: the
 * join-before-create step (D12 fills it; today it passes straight through).
 *
 * Held here rather than on either screen because BOTH doors create accounts
 * now — the log-in door converts an address nobody holds into a sign-up, and
 * lands it on the same credential step. A constant on one screen imported by
 * the other would be a cycle, and a second copy would be the two doors
 * disagreeing about where a new account goes.
 */
export const JOIN_BEFORE_CREATE_PATH = "/auth/join";
