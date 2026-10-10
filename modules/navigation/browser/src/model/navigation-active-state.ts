export const isOnlineEvaluationsActivePath = (pathname: string) =>
  pathname.includes("/online-evaluations") ||
  (pathname.includes("/evaluations/") &&
    !pathname.includes("/analytics") &&
    !pathname.includes("/evaluations/wizard"));

export const isExperimentsActivePath = (pathname: string) =>
  pathname.includes("/experiments") ||
  pathname === "/[project]/evaluations" ||
  pathname.includes("/evaluations/wizard");
