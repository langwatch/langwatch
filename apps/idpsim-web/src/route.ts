/** The pages the simulator serves the console at, read off the address bar. */
export type Route =
  | { page: "landing" }
  | { page: "tenant"; tenantId: number }
  | { page: "sign-in"; tenantId: number; query: string }
  | { page: "not-found" };

const TENANT_PATH = /^\/t\/(\d+)\/?$/u;
const AUTHORIZE_PATH = /^\/t\/(\d+)\/oauth\/authorize\/?$/u;

export const routeOf = ({ pathname, search }: { pathname: string; search: string }): Route => {
  if (pathname === "/" || pathname === "") return { page: "landing" };
  const tenant = TENANT_PATH.exec(pathname)?.[1];
  if (tenant !== undefined) return { page: "tenant", tenantId: Number(tenant) };
  const authorize = AUTHORIZE_PATH.exec(pathname)?.[1];
  if (authorize !== undefined) {
    return { page: "sign-in", tenantId: Number(authorize), query: search.replace(/^\?/u, "") };
  }
  return { page: "not-found" };
};
