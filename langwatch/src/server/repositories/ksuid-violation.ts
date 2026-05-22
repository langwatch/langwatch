// Smoke-test v3 — DO NOT MERGE. User-facing resource using Prisma default
// instead of generate(KSUID_RESOURCES.X) (ksuids.md).

export class ProviderRepository {
  // VIOLATION: user-facing entity (Provider has a URL) created without
  // an explicit KSUID. Prisma default would be nanoid/cuid — wrong shape.
  async create(input: { name: string }): Promise<{ id: string; name: string }> {
    return await fakePrisma.provider.create({ data: input });
  }
}

declare const fakePrisma: { provider: { create: (args: unknown) => Promise<{ id: string; name: string }> } };
