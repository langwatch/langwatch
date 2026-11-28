import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

// The laptop's way into the cache: the cache gate in langwatch-saas
// (infrastructure/live/dev-nx-cache) takes the developer's GitHub token and answers with
// presigned S3 URLs. Members of the langwatch GitHub org read every namespace and write
// their branch; anyone else reads main/ only. No AWS credentials on the laptop.
export const GATE_URL = "https://7dm76pnlduxexrpnjj346z3hke0ysrnv.lambda-url.eu-central-1.on.aws/";

const REFUSED_BACKOFF_MS = 10 * 60_000;
const DOWN_BACKOFF_MS = 60_000;
// The gate refills a token's budget at two calls a second, so a 429 needs only a short rest.
const RATE_BACKOFF_MS = 5_000;
// Keys asked within this window share one gate call, up to the gate's per-call limit.
const BATCH_MS = 20;
const MAX_KEYS = 32;
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
    if (res.status === 429) {
      log("the cache gate is rate limiting this token; resting a few seconds");
      return { backoffMs: RATE_BACKOFF_MS };
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

// Collects the keys of concurrent requests into one call of at most `maxKeys` keys.
const batcher = ({ send, waitMs, maxKeys }) => {
  let open = null;
  const flush = () => {
    const batch = open;
    open = null;
    clearTimeout(batch.timer);
    send({ get: [...batch.get], put: [...batch.put.values()] })
      .then(batch.resolve)
      .catch(() => batch.resolve(null));
  };
  const chunks = (list) =>
    Array.from({ length: Math.ceil(list.length / maxKeys) }, (_, i) =>
      list.slice(i * maxKeys, (i + 1) * maxKeys),
    );
  const merge = (answers) => ({
    get: Object.assign({}, ...answers.map((a) => a?.get ?? {})),
    put: Object.assign({}, ...answers.map((a) => a?.put ?? {})),
  });
  const add = ({ get = [], put = [] }) => {
    const fresh = get.filter((key) => !open?.get.has(key)).length + put.length;
    if (open && open.get.size + open.put.size + fresh > maxKeys) flush();
    if (!open) {
      let resolve;
      const done = new Promise((r) => (resolve = r));
      open = { get: new Set(), put: new Map(), done, resolve, timer: setTimeout(flush, waitMs) };
    }
    const batch = open;
    for (const key of get) batch.get.add(key);
    for (const entry of put) batch.put.set(entry.key, entry);
    if (batch.get.size + batch.put.size >= maxKeys) flush();
    return batch.done;
  };
  // A request larger than one call is split, so no call carries more than `maxKeys` keys.
  return ({ get = [], put = [] }) => {
    if (get.length + put.length <= maxKeys) return add({ get, put });
    const parts = [
      ...chunks(get).map((g) => add({ get: g })),
      ...chunks(put).map((p) => add({ put: p })),
    ];
    return Promise.all(parts).then(merge);
  };
};

// A store for server.mjs. Every failure is a miss or a skipped write, and a gate that is
// down, rate limited or refuses the token is not asked again for a while.
export const gateStore = ({ url, token, now = Date.now, log = () => {}, batchMs = BATCH_MS }) => {
  const reads = readUrls(now);
  let quietUntil = 0;

  const send = async ({ get, put }) => {
    if (now() < quietUntil) return null;
    const answer = await askGate({ url, token, get, put, log });
    if (answer.backoffMs) {
      quietUntil = now() + answer.backoffMs;
      return null;
    }
    reads.keep(get, answer);
    return answer;
  };
  const ask = batcher({ send, waitMs: batchMs, maxKeys: MAX_KEYS });

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
