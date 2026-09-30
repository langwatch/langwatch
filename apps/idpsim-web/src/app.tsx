import { Button, EmptyState, Panel, Section } from "@langwatch/design-system-internal";
import { SimConsole } from "@langwatch/sim-console";

import { Landing } from "./landing.tsx";
import { SignIn } from "./sign-in.tsx";
import { TenantPage } from "./tenant-page.tsx";

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

type AppLocation = Pick<Location, "pathname" | "search">;

/** One page per address: the simulator serves this bundle at each of them. */
export const App = ({ location }: { location: AppLocation }) => {
  const route = routeOf({ pathname: location.pathname, search: location.search });
  switch (route.page) {
    case "landing":
      return <Landing />;
    case "tenant":
      return <TenantPage tenantId={route.tenantId} />;
    case "sign-in":
      return <SignIn tenantId={route.tenantId} query={route.query} />;
    case "not-found":
      return (
        <SimConsole
          sim="idp"
          title="IdP simulator"
          tabs={[]}
          activeTab=""
          onTab={() => undefined}
          status={{ tone: "ok", text: "Serving" }}
        >
          <Section title="Nothing here">
            <Panel>
              <EmptyState
                title="This simulator serves no page at this address"
                description={location.pathname}
                action={<Button href="/">All providers</Button>}
              />
            </Panel>
          </Section>
        </SimConsole>
      );
  }
};
