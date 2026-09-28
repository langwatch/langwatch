import {
  Button,
  EmptyState,
  Page,
  Panel,
  TopBar,
  consoleLinks,
} from "@langwatch/design-system-internal";

import { Landing } from "./landing.tsx";
import { routeOf } from "./route.ts";
import { SignIn } from "./sign-in.tsx";
import { TenantPage } from "./tenant-page.tsx";

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
