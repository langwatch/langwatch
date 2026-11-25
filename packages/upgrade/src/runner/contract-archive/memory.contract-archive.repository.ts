import type { ArchiveCounts, ContractArchiveRepository } from "./contract-archive.repository.ts";

/** The archive tables' twin: each table is its row count; `onCopy` lets a test move the source. */
export class MemoryContractArchiveRepository implements Pick<
  ContractArchiveRepository,
  "counts" | "copy"
> {
  readonly tables = new Map<string, number>();
  copies = 0;

  static create({ onCopy }: { onCopy?: (tables: Map<string, number>) => void } = {}) {
    return new MemoryContractArchiveRepository(onCopy);
  }

  private constructor(private readonly onCopy?: (tables: Map<string, number>) => void) {}

  async counts({ source, archive }: { source: string; archive: string }): Promise<ArchiveCounts> {
    return { source: this.tables.get(source) ?? null, archive: this.tables.get(archive) ?? null };
  }

  async copy({ source, archive }: { source: string; archive: string }): Promise<void> {
    this.copies++;
    this.tables.set(archive, this.tables.get(source) ?? 0);
    this.onCopy?.(this.tables);
  }
}
