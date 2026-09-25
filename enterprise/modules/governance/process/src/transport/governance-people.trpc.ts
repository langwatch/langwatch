// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** The server half of `governancePeople.*`: `governance:view` reads, `governance:manage` writes, as on main. */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { GovernanceRestApi, governancePeopleTrpc } from "@langwatch/enterprise-governance-contract";

export const governancePeopleTrpcTransport = defineTrpcRouter(
  GovernanceRestApi,
  governancePeopleTrpc,
)
  .procedure("list")
  .withPermission("governance:view")
  .handle(({ app, input }) => app.governancePeopleList(input))

  .procedure("suggestions")
  .withPermission("governance:view")
  .handle(({ app, input }) => app.governancePeopleSuggestions(input))

  .procedure("runMatch")
  .withPermission("governance:manage")
  .handle(({ app, input }) => app.governancePeopleRunMatch(input))

  .procedure("confirmSuggestion")
  .withPermission("governance:manage")
  .handle(({ app, input }) => app.governancePeopleConfirmSuggestion(input))
  .build();
