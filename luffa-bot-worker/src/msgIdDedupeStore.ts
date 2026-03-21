export class MsgIdDedupeStore {
  private readonly maxSize: number;
  private readonly seen = new Set<string>();
  private readonly fifo: string[] = [];

  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
  }

  shouldAccept(msgId: string): boolean {
    const normalized = msgId.trim();
    if (!normalized) {
      return false;
    }

    if (this.seen.has(normalized)) {
      return false;
    }

    this.seen.add(normalized);
    this.fifo.push(normalized);

    while (this.fifo.length > this.maxSize) {
      const evicted = this.fifo.shift();
      if (evicted) {
        this.seen.delete(evicted);
      }
    }

    return true;
  }
}

