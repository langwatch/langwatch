// A string-keyed hash table that is looked up where it lies in its buffer, with no parse
// step, so a worker opens a cache of thousands of entries in under a millisecond.
// Layout, little-endian: header (magic, version, slot count, entry count, byte length),
// slots of (key hash, entry offset; 0 is empty), entries of (u16 key length, key,
// u32 value length, value).

const MAGIC = 0x434d574c; // 'LWMC'
const VERSION = 1;
const HEADER = 20;
const SLOT = 8;

/** FNV-1a over UTF-16 code units, never 0, so 0 can mark an empty slot. */
function hashKey(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0 || 1;
}

export class CacheTable {
  readonly size: number;
  private readonly buf: Buffer;
  private readonly slots: number;

  /** A buffer that is missing, damaged or of another version reads as an empty table. */
  constructor(buf: Buffer | undefined) {
    this.buf = buf ?? Buffer.alloc(0);
    const valid =
      this.buf.length >= HEADER &&
      this.buf.readUInt32LE(0) === MAGIC &&
      this.buf.readUInt32LE(4) === VERSION &&
      this.buf.readUInt32LE(16) === this.buf.length;
    this.slots = valid ? this.buf.readUInt32LE(8) : 0;
    this.size = valid ? this.buf.readUInt32LE(12) : 0;
  }

  get(key: string): Buffer | undefined {
    if (this.slots === 0) return undefined;
    const hash = hashKey(key);
    const mask = this.slots - 1;
    try {
      for (let i = hash & mask, probes = 0; probes < this.slots; i = (i + 1) & mask, probes++) {
        const offset = this.buf.readUInt32LE(HEADER + i * SLOT + 4);
        if (offset === 0) return undefined;
        if (this.buf.readUInt32LE(HEADER + i * SLOT) !== hash) continue;
        const entry = this.entryAt(offset);
        if (entry[0] === key) return entry[1];
      }
    } catch {
      // An offset past the end of a damaged file is a miss, never a wrong answer.
    }
    return undefined;
  }

  *entries(): Generator<[string, Buffer]> {
    for (let i = 0; i < this.slots; i++) {
      const offset = this.buf.readUInt32LE(HEADER + i * SLOT + 4);
      if (offset !== 0) yield this.entryAt(offset);
    }
  }

  static build(entries: Map<string, Buffer>): Buffer {
    let slots = 16;
    while (slots < entries.size * 2) slots *= 2;
    const table = Buffer.alloc(HEADER + slots * SLOT);
    const parts: Buffer[] = [table];
    let length = table.length;
    let count = 0;
    for (const [key, value] of entries) {
      const keyBytes = Buffer.from(key, "utf8");
      if (keyBytes.length > 0xffff) continue;
      const head = Buffer.alloc(2 + keyBytes.length + 4);
      head.writeUInt16LE(keyBytes.length, 0);
      keyBytes.copy(head, 2);
      head.writeUInt32LE(value.length, 2 + keyBytes.length);
      const hash = hashKey(key);
      let i = hash & (slots - 1);
      while (table.readUInt32LE(HEADER + i * SLOT + 4) !== 0) i = (i + 1) & (slots - 1);
      table.writeUInt32LE(hash, HEADER + i * SLOT);
      table.writeUInt32LE(length, HEADER + i * SLOT + 4);
      parts.push(head, value);
      length += head.length + value.length;
      count++;
    }
    table.writeUInt32LE(MAGIC, 0);
    table.writeUInt32LE(VERSION, 4);
    table.writeUInt32LE(slots, 8);
    table.writeUInt32LE(count, 12);
    table.writeUInt32LE(length, 16);
    return Buffer.concat(parts, length);
  }

  private entryAt(offset: number): [string, Buffer] {
    const keyLength = this.buf.readUInt16LE(offset);
    const valueAt = offset + 2 + keyLength + 4;
    const valueLength = this.buf.readUInt32LE(valueAt - 4);
    if (valueAt + valueLength > this.buf.length) throw new RangeError("entry past end of table");
    return [
      this.buf.toString("utf8", offset + 2, offset + 2 + keyLength),
      this.buf.subarray(valueAt, valueAt + valueLength),
    ];
  }
}
