import { createHash, createHmac } from "node:crypto";
import { request } from "node:https";

// A two-call S3 client (GetObject, conditional PutObject) signed with SigV4, so the
// cache needs no SDK in the workspace root. Keys are limited to [A-Za-z0-9._/-].
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

export const signedHeaders = ({
  method,
  host,
  path,
  region,
  credentials,
  headers = {},
  now = new Date(),
  payloadHash = "UNSIGNED-PAYLOAD",
}) => {
  const amzDate = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const all = {
    ...headers,
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...(credentials.sessionToken ? { "x-amz-security-token": credentials.sessionToken } : {}),
  };
  const names = Object.keys(all)
    .map((n) => n.toLowerCase())
    .toSorted();
  const lower = Object.fromEntries(
    Object.entries(all).map(([k, v]) => [k.toLowerCase(), String(v).trim()]),
  );
  const canonical = [
    method,
    path,
    "",
    ...names.map((n) => `${n}:${lower[n]}`),
    "",
    names.join(";"),
    payloadHash,
  ].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const key = hmac(
    hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, day), region), "s3"),
    "aws4_request",
  );
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  return {
    ...lower,
    authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
  };
};

const objectPath = (key) => {
  if (!/^[A-Za-z0-9._/-]+$/.test(key)) throw new Error(`unsafe cache key ${key}`);
  return `/${key}`;
};

const s3Request = ({ bucket, region, credentials, method, key, headers, timeoutMs }) => {
  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const path = objectPath(key);
  return request({
    host,
    path,
    method,
    headers: signedHeaders({ method, host, path, region, credentials, headers }),
    timeout: timeoutMs,
  });
};

// Resolves the S3 response (status and readable body) without reading it.
export const getObject = ({ bucket, region, credentials, key, timeoutMs = 30_000 }) =>
  new Promise((resolve, reject) => {
    const req = s3Request({ bucket, region, credentials, method: "GET", key, timeoutMs });
    req.on("response", resolve);
    req.on("timeout", () => req.destroy(new Error("S3 GET timed out")));
    req.on("error", reject);
    req.end();
  });

// First write wins (If-None-Match: *): an entry is never replaced once stored. Only the
// taint marker overwrites, to restart its expiry.
export const putObject = ({
  bucket,
  region,
  credentials,
  key,
  body,
  length,
  overwrite = false,
  timeoutMs = 120_000,
}) =>
  new Promise((resolve, reject) => {
    const req = s3Request({
      bucket,
      region,
      credentials,
      method: "PUT",
      key,
      headers: {
        "content-length": length,
        ...(overwrite ? {} : { "if-none-match": "*" }),
        "content-type": "application/octet-stream",
      },
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
