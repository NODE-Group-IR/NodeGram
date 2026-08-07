/**
 * Best-effort warm-instance token bucket per authenticated client.
 *
 * NOT distributed. NOT a security or quota boundary.
 * Disable with NODEGRAM_RATE_LIMIT=off or NODEGRAM_BURST=0.
 */

export interface TokenBucketOptions {
  burst: number;
  refillPerSecond: number;
  maxEntries?: number;
  staleMs?: number;
  now?: () => number;
}

interface BucketState {
  tokens: number;
  updatedAt: number;
}

const DEFAULT_MAX_ENTRIES = 1_024;
const DEFAULT_STALE_MS = 10 * 60_000;

export class BestEffortRateLimiter {
  private readonly burst: number;
  private readonly refillPerSecond: number;
  private readonly maxEntries: number;
  private readonly staleMs: number;
  private readonly now: () => number;
  private readonly buckets = new Map<string, BucketState>();

  constructor(options: TokenBucketOptions) {
    this.burst = options.burst;
    this.refillPerSecond = options.refillPerSecond;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.staleMs = options.staleMs ?? DEFAULT_STALE_MS;
    this.now = options.now ?? Date.now;
  }

  size(): number {
    return this.buckets.size;
  }

  private evictStale(now: number): void {
    for (const [key, state] of this.buckets) {
      if (now - state.updatedAt > this.staleMs) {
        this.buckets.delete(key);
      }
    }
  }

  private ensureCapacity(now: number): void {
    if (this.buckets.size < this.maxEntries) {
      return;
    }
    this.evictStale(now);
    if (this.buckets.size < this.maxEntries) {
      return;
    }
    // Evict oldest by updatedAt
    let oldestKey: string | undefined;
    let oldestAt = Infinity;
    for (const [key, state] of this.buckets) {
      if (state.updatedAt < oldestAt) {
        oldestAt = state.updatedAt;
        oldestKey = key;
      }
    }
    if (oldestKey !== undefined) {
      this.buckets.delete(oldestKey);
    }
  }

  /**
   * Attempt to consume one token for the given client key.
   * Returns true if allowed, false if limited.
   */
  tryConsume(clientKey: string): boolean {
    if (this.burst <= 0 || this.refillPerSecond < 0) {
      return true;
    }

    const now = this.now();
    let state = this.buckets.get(clientKey);
    if (!state) {
      this.ensureCapacity(now);
      state = { tokens: this.burst, updatedAt: now };
      this.buckets.set(clientKey, state);
    } else {
      const elapsedSec = Math.max(0, (now - state.updatedAt) / 1000);
      state.tokens = Math.min(this.burst, state.tokens + elapsedSec * this.refillPerSecond);
      state.updatedAt = now;
    }

    if (state.tokens < 1) {
      return false;
    }
    state.tokens -= 1;
    return true;
  }
}

let sharedLimiter: BestEffortRateLimiter | undefined;
let sharedBurst = -1;
let sharedRefill = -1;

export function getSharedRateLimiter(
  burst: number,
  refillPerSecond: number,
): BestEffortRateLimiter {
  if (!sharedLimiter || sharedBurst !== burst || sharedRefill !== refillPerSecond) {
    sharedLimiter = new BestEffortRateLimiter({ burst, refillPerSecond });
    sharedBurst = burst;
    sharedRefill = refillPerSecond;
  }
  return sharedLimiter;
}

export function resetSharedRateLimiterForTests(): void {
  sharedLimiter = undefined;
  sharedBurst = -1;
  sharedRefill = -1;
}
