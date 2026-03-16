/**
 * Sets safe default environment variables needed by langwatch pipeline imports.
 * The pipeline files import from the event-sourcing framework which uses @t3-oss/env,
 * requiring these env vars to be present even though deja-view doesn't use them.
 *
 * Must be imported before pipelineDiscovery.ts.
 */

if (!process.env.NODE_ENV) process.env.NODE_ENV = "development";
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = "postgresql://fake:fake@localhost:5432/fake";
if (!process.env.BASE_HOST) process.env.BASE_HOST = "http://localhost:3000";
if (!process.env.NEXTAUTH_SECRET) process.env.NEXTAUTH_SECRET = "skynet-fake-secret";
if (!process.env.NEXTAUTH_URL) process.env.NEXTAUTH_URL = "http://localhost:3000";
if (!process.env.API_TOKEN_JWT_SECRET) process.env.API_TOKEN_JWT_SECRET = "skynet-fake-jwt-secret";
if (!process.env.ELASTICSEARCH_NODE_URL) process.env.ELASTICSEARCH_NODE_URL = "http://localhost:9200";
