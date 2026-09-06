// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * A stand-in identity provider, in this process.
 *
 * Its discovery document puts the authorize, token and userinfo endpoints on a
 * DIFFERENT path from the issuer -- the Cognito arrangement, and the reason
 * the deployment reads the document instead of deriving URLs itself.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeOidcProvider {
  issuer: string;
  authorizationEndpoint: string;
  stop(): Promise<void>;
}

export async function startFakeOidcProvider(): Promise<FakeOidcProvider> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    const issuer = `http://${request.headers.host}/oidc/2`;

    if (url.pathname === "/oidc/2/.well-known/openid-configuration") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          issuer,
          authorization_endpoint: `${issuer}/hosted-ui/oauth2/authorize`,
          token_endpoint: `${issuer}/hosted-ui/oauth2/token`,
          userinfo_endpoint: `${issuer}/hosted-ui/oauth2/userInfo`,
          jwks_uri: `${issuer}/.well-known/jwks.json`,
          response_types_supported: ["code"],
          scopes_supported: ["openid", "email", "profile"],
        }),
      );
      return;
    }

    response.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const issuer = `http://127.0.0.1:${port}/oidc/2`;

  return {
    issuer,
    authorizationEndpoint: `${issuer}/hosted-ui/oauth2/authorize`,
    stop: () => stopServer(server),
  };
}

function stopServer(server: Server): Promise<void> {
  return new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
