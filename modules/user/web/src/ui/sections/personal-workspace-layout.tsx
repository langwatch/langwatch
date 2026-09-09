/**
 * The frame every `/me/*` page renders inside.
 *
 * `platform/app`'s `MyLayout` wrapped `DashboardLayout` in `personalScope`
 * mode — the whole application chrome: the header logo, the workspace chip, the
 * avatar and the personal-scope sidebar — and then put a container around the
 * page. The chrome is application composition a feature-web package may not
 * import, and it is not the family's anyway: chrome belongs to the route tree.
 *
 * So what moved is the container, which is all this layer ever was.
 *
 * KNOWN GAP, stated out loud for the same reason `GatewayLayout` and
 * `GovernanceLayout` state theirs: the outer `DashboardLayout` does not come
 * with it. A `/me` page served from `apps/ui` renders this frame and its
 * content, and the application header, sidebar and workspace chip are not above
 * it until a chrome layout route exists in the route table. That route is a
 * structural slice of its own.
 *
 * WHAT ELSE DID NOT TRAVEL: `MyLayout` also wrote `lastVisitedHomeKind` to
 * local storage on every `/me/*` visit, which the `/` index resolver reads to
 * decide where a reader with no explicit pin lands. That is landing policy and
 * a browser-storage write, and a feature-web package may do neither; it belongs
 * to the application that owns the address. It now lives in the frontend
 * feature that mounts these screens (`apps/ui/src/features/personal-workspace`),
 * which is also where the gateway family put the redirects it took off
 * `useOrganizationTeamProject`.
 */

import { Box, Container } from "@chakra-ui/react";
import type { PropsWithChildren } from "react";

export function PersonalWorkspaceLayout({ children }: PropsWithChildren) {
  return (
    <Container maxW="container.xl" paddingX={4} paddingY={4}>
      <Box width="full">{children}</Box>
    </Container>
  );
}

export default PersonalWorkspaceLayout;
