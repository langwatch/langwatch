package shapemod

import "testing"

func TestClassify(t *testing.T) {
	cases := []struct {
		name     string
		file     string
		content  string
		siblings map[string]string
		want     Tier
	}{
		{
			name: "prisma repository via filename prefix",
			file: "postgres.project.adapter.ts",
			content: `
export class PostgresProjectAdapter {
  findById(id: string) {}
}
`,
			want: TierPrisma,
		},
		{
			name: "prisma repository via relative import specifier, no filename prefix",
			file: "thing-sync.adapter.ts",
			content: `
import { PrismaThingRepository } from "../repositories/prisma/prisma.thing.repository.ts";
export class ThingSyncAdapter {
  build() { return PrismaThingRepository.create({}); }
}
`,
			want: TierPrisma,
		},
		{
			name: "memory repository via filename prefix only",
			file: "memory.thing.adapter.ts",
			content: `
export class MemoryThingAdapter {
  private store = new Map<string, string>();
}
`,
			want: TierMemory,
		},
		{
			name: "a Map with no memory filename or symbol prefix is not evidence of memory",
			file: "sqs.webhook-destination.adapter.ts",
			content: `
import { SQSClient } from "@aws-sdk/client-sqs";
const clients = new Map<string, SQSClient>();
export class SqsWebhookDestinationAdapter {
  async findSharedKey() {}
}
`,
			want: TierInfrastructure,
		},
		{
			name: "clickhouse repository via client import",
			file: "usage.adapter.ts",
			content: `
import { ClickHouseClient } from "@langwatch/clickhouse-client";
export class ClickhouseUsageAdapter {
  async list() { return []; }
}
`,
			want: TierClickhouse,
		},
		{
			name: "redis repository via client import even with a Map fallback",
			file: "share.adapter.ts",
			content: `
import Redis from "ioredis";
export class RedisShareAdapter {
  private memory = new Map<string, string>();
  async findSharedKey() {}
}
`,
			want: TierRedis,
		},
		{
			name: "abstract class with repository-shaped member and no body is an interface",
			file: "thing.port.ts",
			content: `
export abstract class ThingPort {
  abstract findById(id: string): Promise<Thing | undefined>;
  abstract create(thing: Thing): Promise<void>;
}
`,
			siblings: map[string]string{
				"modules/thing/server/src/repositories/prisma/prisma.thing.repository.ts": `
export class PrismaThing {
  findById(id: string) { return undefined; }
}
`,
			},
			want: TierInterface,
		},
		{
			name: "a port with no in-module implementation stays infrastructure",
			file: "orphan.port.ts",
			content: `
export interface OrphanPort {
  findById(id: string): Promise<unknown>;
}
`,
			want: TierInfrastructure,
		},
		{
			name: "a port with a prisma twin implementing it by name is an interface",
			file: "widget.port.ts",
			content: `
export interface WidgetPort {
  findById(id: string): Promise<unknown>;
}
`,
			siblings: map[string]string{
				"modules/widget/server/src/repositories/prisma/prisma.widget.repository.ts": `
export class PrismaWidgetRepository implements WidgetPort {
  findById(id: string) { return null; }
}
`,
			},
			want: TierInterface,
		},
		{
			name: "abstract class with a concrete method body must be split first",
			file: "thing.port.ts",
			content: `
export abstract class ThingPort {
  abstract findById(id: string): Promise<Thing | undefined>;
  create(thing: Thing): Promise<void> {
    return Promise.resolve();
  }
}
`,
			want: TierSplit,
		},
		{
			name: "interface with repository-shaped member",
			file: "thing.store.ts",
			content: `
export interface ThingStore {
  save(thing: Thing): Promise<void>;
}
`,
			siblings: map[string]string{
				"modules/thing/server/src/repositories/memory/memory.thing.repository.ts": `
export class MemoryThing {
  save(thing: unknown) {}
}
`,
			},
			want: TierInterface,
		},
		{
			name: "abstract class with only technical members is infrastructure",
			file: "clock.port.ts",
			content: `
export abstract class ClockPort {
  abstract now(): Date;
}
`,
			want: TierInfrastructure,
		},
		{
			name: "concrete class is infrastructure even with find-like usage",
			file: "token.adapter.ts",
			content: `
export class TokenAdapter {
  findTokenParts(token: string) { return null; }
}
`,
			want: TierInfrastructure,
		},
		{
			name: "plain diagnostics adapter is infrastructure",
			file: "diagnostics.adapter.ts",
			content: `
export class DiagnosticsAdapter {
  warn(context: Record<string, unknown>, message: string): void {}
}
`,
			want: TierInfrastructure,
		},
		{
			name: "an error class sharing the file is never picked as the symbol",
			file: "dataset-normalize.adapter.ts",
			content: `
export class LargeJsonUnsupportedError extends Error {
  constructor(message = "too large") {
    super(message);
  }
}
export class DatasetNormalizeAdapter {
  async normalize() {}
}
`,
			want: TierInfrastructure,
		},
		{
			name: "a Map inside a plain adapter is not evidence of memory",
			file: "dataset-upload.adapter.ts",
			content: `
export class DatasetUploadAdapter {
  createDatasetFromUpload() {
    const rename = new Map(Object.entries({}));
    return rename;
  }
}
`,
			want: TierInfrastructure,
		},
		{
			name: "multiple exports containing the subject is a split, not a guess",
			file: "project.port.ts",
			content: `
export abstract class ProjectCredentialsPort {
  abstract generateProjectId(): string;
}
export abstract class ProjectKeyMapPort {
  abstract syncProject(input: { projectId: string }): Promise<void>;
}
`,
			want: TierSplit,
		},
		{
			name: "a thin adapter wrapping the existing prisma repository of the same subject is wiring, not prisma",
			file: "thing.adapter.ts",
			content: `
import { PrismaThingRepository } from "../repositories/prisma/prisma.thing.repository.ts";
export class ThingAdapter {
  constructor(private repo: PrismaThingRepository) {}
  findById(id: string) { return this.repo.findById(id); }
}
`,
			want: TierInfrastructure,
		},
		{
			name: "a resolver port that does not contain the storage subject is not the symbol",
			file: "dataset-storage.port.ts",
			content: `
export abstract class DatasetS3ClientResolverPort {
  abstract acquire(projectId: string): Promise<unknown>;
}
export interface DatasetStorage {
  writeChunks(params: unknown): Promise<unknown>;
}
export abstract class DatasetStorageResolverPort {
  abstract forProject(projectId: string): Promise<DatasetStorage>;
}
`,
			want: TierInfrastructure,
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := Classify(c.file, c.content, c.siblings)
			if got.Tier != c.want {
				t.Errorf("Classify() tier = %q, want %q (reason: %s, symbol: %q)", got.Tier, c.want, got.Reason, got.Symbol)
			}
		})
	}
}

func TestSubjectName(t *testing.T) {
	cases := map[string]string{
		"agent-sandbox-key-share.port.ts":               "agent-sandbox-key-share",
		"redis.agent-sandbox-key-share.adapter.ts":      "agent-sandbox-key-share",
		"absent.agent-sandbox-key-share.adapter.ts":     "agent-sandbox-key-share",
		"api-key-token.api-key-token.adapter.ts":        "api-key-token",
		"eventing.agent-sandbox-maintenance.adapter.ts": "agent-sandbox-maintenance",
	}
	for filename, want := range cases {
		if got := subjectName(filename); got != want {
			t.Errorf("subjectName(%q) = %q, want %q", filename, got, want)
		}
	}
}

func TestPascalCase(t *testing.T) {
	cases := map[string]string{
		"agent-sandbox-key-share": "AgentSandboxKeyShare",
		"clickhouse-usage":        "ClickHouseUsage",
		"openai-connection":       "OpenAIConnection",
		"langwatch-nexus":         "LangWatchNexus",
		"sso-config":              "SSOConfig",
		"scim-provisioning":       "SCIMProvisioning",
		"otlp-export":             "OTLPExport",
		"http-client":             "HTTPClient",
		"s3-object":               "S3Object",
	}
	for kebab, want := range cases {
		if got := pascalCase(kebab); got != want {
			t.Errorf("pascalCase(%q) = %q, want %q", kebab, got, want)
		}
	}
}
