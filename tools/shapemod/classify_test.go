package shapemod

import "testing"

func TestClassify(t *testing.T) {
	cases := []struct {
		name    string
		content string
		want    Tier
	}{
		{
			name: "prisma repository via named import",
			content: `
import { PrismaRepository } from "@langwatch/prisma-client";
export class PostgresProjectAdapter {
  findById(id: string) {}
}
`,
			want: TierPrisma,
		},
		{
			name: "prisma repository via package specifier",
			content: `
import { something } from "@langwatch/prisma-client";
export class PostgresThingAdapter {}
`,
			want: TierPrisma,
		},
		{
			name: "memory repository via new Map with no datastore import",
			content: `
export class MemoryThingAdapter {
  private store = new Map<string, string>();
}
`,
			want: TierMemory,
		},
		{
			name: "clickhouse repository via client import",
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
			name: "abstract class with repository-shaped member is an interface",
			content: `
export abstract class ThingPort {
  abstract findById(id: string): Promise<Thing | undefined>;
  abstract create(thing: Thing): Promise<void>;
}
`,
			want: TierInterface,
		},
		{
			name: "interface with repository-shaped member",
			content: `
export interface ThingStore {
  save(thing: Thing): Promise<void>;
}
`,
			want: TierInterface,
		},
		{
			name: "abstract class with only technical members is infrastructure",
			content: `
export abstract class ClockPort {
  abstract now(): Date;
}
`,
			want: TierInfrastructure,
		},
		{
			name: "concrete class is infrastructure even with find-like usage",
			content: `
export class TokenAdapter {
  findTokenParts(token: string) { return null; }
}
`,
			want: TierInfrastructure,
		},
		{
			name: "plain diagnostics adapter is infrastructure",
			content: `
export class DiagnosticsAdapter {
  warn(context: Record<string, unknown>, message: string): void {}
}
`,
			want: TierInfrastructure,
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := Classify(c.content)
			if got.Tier != c.want {
				t.Errorf("Classify() tier = %q, want %q (reason: %s)", got.Tier, c.want, got.Reason)
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
	if got := pascalCase("agent-sandbox-key-share"); got != "AgentSandboxKeyShare" {
		t.Errorf("pascalCase() = %q", got)
	}
}
