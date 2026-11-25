import { requireDeploymentMode } from "../deployment-mode.ts";
import { closeDb, findUserIdByEmail } from "../front-door/db";
import { expect, test } from "../test.ts";
import { activity, addUser, expectReachedIdp } from "./idpsim.ts";
import {
  completeTestSignIn,
  connectionState,
  givenAConfirmedLocalAccount,
  givenALiveOidcConnection,
  givenAnAdministratorOwningAnOrganisation,
  goLive,
  memberOf,
  proveDomain,
  registerOidcConnection,
  registerSamlConnection,
  sessionUser,
  signInThroughSso,
  TENANT,
  trpc,
} from "./steps.ts";

test.afterAll(async () => {
  await closeDb();
});

test.describe("SSO journeys @saas", () => {
  /** @scenario A member signs in through the organisation's OIDC connection */
  test("a member signs in through the organisation's OIDC connection", async ({
    page,
    request,
    browser,
    baseURL,
  }) => {
    requireDeploymentMode({ mode: "saas" });
    const { org, connection } = await givenALiveOidcConnection({ page, request, baseURL });
    const email = `member@${org.domain}`;
    await addUser({ request, tenant: TENANT, email });

    const member = await signInThroughSso({ browser, baseURL, email });

    expect((await sessionUser({ page: member })).email).toBe(email);
    await expectReachedIdp({
      request,
      tenant: TENANT,
      kind: "oidc.token",
      client: connection.clientId ?? undefined,
      subject: email,
    });
  });

  /** @scenario A member signs in through the organisation's SAML connection */
  test("a member signs in through the organisation's SAML connection", async ({
    page,
    request,
    browser,
    baseURL,
  }) => {
    requireDeploymentMode({ mode: "saas" });
    const org = await givenAnAdministratorOwningAnOrganisation({ page, request });
    const connection = await registerSamlConnection({ page, baseURL, org });
    await proveDomain({ page, org, connection });
    await completeTestSignIn({ page, baseURL, org, connection });
    await goLive({ page, org, connection });
    const email = `member@${org.domain}`;
    await addUser({ request, tenant: TENANT, email });

    const member = await signInThroughSso({ browser, baseURL, email });

    expect((await sessionUser({ page: member })).email).toBe(email);
    await expectReachedIdp({ request, tenant: TENANT, kind: "saml.sso", subject: email });
  });

  /** @scenario A connection goes from registration to live to teardown */
  test("a connection goes from registration to live to teardown", async ({
    page,
    request,
    baseURL,
  }) => {
    requireDeploymentMode({ mode: "saas" });
    const org = await givenAnAdministratorOwningAnOrganisation({ page, request });
    const connection = await registerOidcConnection({ page, baseURL, org });

    await proveDomain({ page, org, connection });
    await completeTestSignIn({ page, baseURL, org, connection });
    await goLive({ page, org, connection });
    expect(await connectionState({ page, org, connection })).toBe("ACTIVE");

    const removal = await trpc({
      request: page.request,
      kind: "mutation",
      path: "ssoSetup.removeConnection",
      input: {
        organizationId: org.organizationId,
        connectionId: connection.connectionId,
        reason: null,
      },
    });
    expect(removal.error).toBeNull();
    expect(await connectionState({ page, org, connection })).not.toBe("ACTIVE");
  });

  /** @scenario A first sign-in creates the user and their membership */
  test("a first sign-in creates the user and their membership", async ({
    page,
    request,
    browser,
    baseURL,
  }) => {
    requireDeploymentMode({ mode: "saas" });
    const { org } = await givenALiveOidcConnection({ page, request, baseURL });
    const email = `newcomer@${org.domain}`;
    await addUser({ request, tenant: TENANT, email });
    expect(await findUserIdByEmail(email)).toBeNull();

    const newcomer = await signInThroughSso({ browser, baseURL, email });

    expect(await findUserIdByEmail(email)).not.toBeNull();
    expect(await memberOf({ page: newcomer, organizationId: org.organizationId })).toBe(true);
  });

  /** @scenario A confirmed local account is linked rather than duplicated */
  test("a confirmed local account is linked rather than duplicated", async ({
    page,
    request,
    browser,
    baseURL,
  }) => {
    requireDeploymentMode({ mode: "saas" });
    const { org } = await givenALiveOidcConnection({ page, request, baseURL });
    const email = `local@${org.domain}`;
    await addUser({ request, tenant: TENANT, email });
    const localUserId = await givenAConfirmedLocalAccount({ request, email });

    const member = await signInThroughSso({ browser, baseURL, email });

    expect((await sessionUser({ page: member })).id).toBe(localUserId);
  });

  /** @scenario On the hosted product the licence gate leaves sign-on available */
  test("on the hosted product the licence gate leaves sign-on available", async ({
    page,
    request,
    baseURL,
  }) => {
    requireDeploymentMode({ mode: "saas" });
    const org = await givenAnAdministratorOwningAnOrganisation({ page, request });

    const connection = await registerOidcConnection({ page, baseURL, org });

    expect(connection.connectionId).not.toBe("");
  });
});

test.describe("SSO journeys @sh-free", () => {
  /** @scenario Without a licence a self-hosted stack refuses to register a connection */
  test("without a licence a self-hosted stack refuses to register a connection", async ({
    page,
    request,
    baseURL,
  }) => {
    requireDeploymentMode({ mode: "sh-free" });
    const org = await givenAnAdministratorOwningAnOrganisation({ page, request });

    const refused = await registerOidcConnection({ page, baseURL, org }).then(
      () => null,
      (error: unknown) => String(error),
    );

    expect(refused).toMatch(/ssoSetup\.register refused \(4\d\d\)/);
    const clients = (await activity({ request, tenant: TENANT })).filter(
      (event) => event.kind === "oidc.authorize",
    );
    expect(clients.every((event) => !event.subject?.endsWith(`@${org.domain}`))).toBe(true);
  });
});
