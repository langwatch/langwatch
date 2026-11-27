import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

// The laptop's way into the cache: the cache gate in langwatch-saas
// (infrastructure/live/dev-nx-cache) takes the developer's GitHub token and answers with
// presigned S3 URLs. Members of the langwatch GitHub org read every namespace and write
// their branch; anyone else reads main/ only. No AWS credentials on the laptop.
export const GATE_URL = "https://7dm76pnlduxexrpnjj346z3hke0ysrnv.lambda-url.eu-central-1.on.aws/";

const REFUSED_BACKOFF_MS = 10 * 60_000;
const DOWN_BACKOFF_MS = 60_000;
// A URL is used only while it has this much life left.
const URL_MARGIN_MS = 30_000;

const send = ({ url, method, headers = {}, timeoutMs }) => {
  const target = new URL(url);
  const request = target.protocol === "https:" ? httpsRequest : httpRequest;
  return request(target, { method, headers, timeout: timeoutMs });
};

const getUrl = (url, timeoutMs = 30_000) =>
  new Promise((resolve, reject) => {
    const req = send({ url, method: "GET", timeoutMs });
    req.on("response", resolve);
    req.on("timeout", () => req.destroy(new Error("S3 GET timed out")));
    req.on("error", reject);
    req.end();
  });

const putUrl = ({ url, body, length, timeoutMs = 120_000 }) =>
  new Promise((resolve, reject) => {
    const req = send({
      url,
      method: "PUT",
      // The gate signed both headers: S3 refuses the upload without them.
      headers: { "content-length": length, "if-none-match": "*" },
      timeoutMs,
    });
    req.on("response", (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on("timeout", () => req.destroy(new Error("S3 PUT timed out")));
    req.on("error", reject);
    body.on("error", (error) => req.destroy(error));
    body.pipe(req);
  });

// One gate call. Resolves the answer, or { backoffMs } when the gate should rest.
const askGate = async ({ url, token, get, put, log }) => {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ get, put }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401) {
      log("the cache gate refused the GitHub token; run gh auth login to turn the cache on");
      return { backoffMs: REFUSED_BACKOFF_MS };
    }
    if (!res.ok) throw new Error(`the cache gate answered ${res.status}`);
    return await res.json();
  } catch (error) {
    log(`cache gate unavailable: ${error.message}`);
    return { backoffMs: DOWN_BACKOFF_MS };
  }
};

// The read URLs the gate signed, by key; url null means it would not sign that read.
const readUrls = (now) => {
  const signed = new Map();
  const fresh = (key) => signed.get(key)?.until > now();
  return {
    fresh,
    keep: (keys, answer) => {
      const until = now() + (answer.expiresIn ?? 300) * 1000 - URL_MARGIN_MS;
      for (const key of keys) signed.set(key, { url: answer.get?.[key] ?? null, until });
    },
    // A signed read serves once; the next lookup of the key asks the gate again.
    take: (key) => {
      const url = fresh(key) ? signed.get(key).url : null;
      signed.delete(key);
      return url;
    },
  };
};

const download = async (url) => {
  const res = await getUrl(url);
  if (res.statusCode === 200) return { body: res, length: res.headers["content-length"] };
  res.resume();
  return null;
};

// A store for server.mjs. Every failure is a miss or a skipped write, and a gate that is
// down or refuses the token is not asked again for a while.
export const gateStore = ({ url, token, now = Date.now, log = () => {} }) => {
  const reads = readUrls(now);
  let quietUntil = 0;

  const ask = async ({ get = [], put = [] }) => {
    if (now() < quietUntil) return null;
    const answer = await askGate({ url, token, get, put, log });
    if (answer.backoffMs) {
      quietUntil = now() + answer.backoffMs;
      return null;
    }
    reads.keep(get, answer);
    return answer;
  };

  return {
    // One gate call for every namespace a lookup will try.
    prepare: async (keys) => {
      const missing = keys.filter((key) => !reads.fresh(key));
      if (missing.length > 0) await ask({ get: missing });
    },
    get: async (key) => {
      if (!reads.fresh(key)) await ask({ get: [key] });
      const target = reads.take(key);
      return target ? download(target) : null;
    },
    put: async (key, body, length) => {
      const target = (await ask({ put: [{ key, length }] }))?.put?.[key];
      if (target) return putUrl({ url: target, body, length });
      body.resume();
      return 0;
    },
  };
};
