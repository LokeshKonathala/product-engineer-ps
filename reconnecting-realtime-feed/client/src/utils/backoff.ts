export const BASE_DELAY_MS = 1000;
export const MAX_DELAY_MS = 30000;
export const JITTER_MS = 500;

/**
 * delay = min(base * 2^attempt, max) + jitter — exponential backoff with a
 * ceiling, so a down server is retried ever more slowly (never a tight loop)
 * and many clients don't reconnect in lockstep. `random` is injectable so the
 * schedule is testable.
 */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const exponential = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  return exponential + random() * JITTER_MS;
}
