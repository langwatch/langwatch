import dns from "dns";

const VERIFICATION_HOST = "_langwatch-verification";
const VERIFICATION_PREFIX = "langwatch-verify=";
const RESOLVERS = ["1.1.1.1", "8.8.8.8"];
const TIMEOUT_MS = 3000;
const MAX_RETRIES = 2;

async function resolveTxtWithServer({
  domain,
  server,
}: {
  domain: string;
  server: string;
}): Promise<string[][]> {
  const resolver = new dns.promises.Resolver();
  resolver.setServers([server]);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("DNS lookup timed out")),
      TIMEOUT_MS,
    );

    resolver
      .resolveTxt(domain)
      .then((records) => {
        clearTimeout(timer);
        resolve(records);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export async function verifyDomainDns({
  domain,
  expectedToken,
}: {
  domain: string;
  expectedToken: string;
}): Promise<boolean> {
  const lookupDomain = `${VERIFICATION_HOST}.${domain}`;
  const expectedValue = `${VERIFICATION_PREFIX}${expectedToken}`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    for (const server of RESOLVERS) {
      try {
        const records = await resolveTxtWithServer({
          domain: lookupDomain,
          server,
        });

        const allText = records.flat();
        if (allText.some((txt) => txt.includes(expectedValue))) {
          return true;
        }
      } catch {
        continue;
      }
    }
  }

  return false;
}
