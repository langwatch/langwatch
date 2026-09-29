import {
  Button,
  EmptyState,
  Page,
  Panel,
  TopBar,
  consoleLinks,
} from "@langwatch/design-system-internal";

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

type AppLocation = Pick<Location, "protocol" | "hostname" | "port" | "pathname" | "search">;

/** One page per address: the simulator serves this bundle at each of them. */
export const App = ({ location }: { location: AppLocation }) => {
  const chrome = consoleLinks({ location });
  const nav = (
    <TopBar
      name="IdP simulator"
      slug={chrome.slug}
      homeHref={chrome.homeHref}
      links={chrome.links}
    />
  );
  const route = routeOf({ pathname: location.pathname, search: location.search });
  switch (route.page) {
    case "landing":
      return <Landing nav={nav} />;
    case "tenant":
      return <TenantPage nav={nav} tenantId={route.tenantId} />;
    case "sign-in":
      return <SignIn nav={nav} tenantId={route.tenantId} query={route.query} />;
    case "not-found":
      return (
        <Page nav={nav} title="Nothing here">
          <Panel>
            <EmptyState
              title="This simulator serves no page at this address"
              description={location.pathname}
              action={<Button href="/">All providers</Button>}
            />
          </Panel>
        </Page>
      );
  }
};
