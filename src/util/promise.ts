export async function promisePool<T>(
  factory: (i: number, stop: () => void) => Promise<T>,
  concurrency = 10,
  maxLoops = Infinity
): Promise<T[]> {
  let done: Promise<T>[] = [];
  let stoppers: Promise<T>[] = [];
  let running: Promise<T>[] = [];

  let i = 0;
  const isStopped = () => stoppers.length !== 0 || i >= maxLoops;
  while (!isStopped()) {
    while (!isStopped() && running.length < concurrency) {
      const promise = factory(i++, async () => {
        await Promise.resolve();
        stoppers.push(promise);
      });
      running.push(promise);
      promise.then(() => {
        running = running.filter((p) => p !== promise);
        done.push(promise);
      });
    }

    await Promise.race(running);
  }
  done.push(...running);

  done = done.filter((promise) => !stoppers.includes(promise));

  return await Promise.all(done);
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function catchedRace<T extends readonly unknown[] | []>(
  values: T
): Promise<Awaited<T[number]>>;
export function catchedRace<T>(
  values: Iterable<T | PromiseLike<T>>
): Promise<Awaited<T>>;
export function catchedRace<T>(
  values: Iterable<T | PromiseLike<T>> | T[]
): Promise<Awaited<T>> {
  return Promise.race(
    Array.from(values).map((value) => {
      if (
        typeof value === 'object' &&
        value !== null &&
        'catch' in value &&
        typeof value.catch === 'function'
      ) {
        return value.catch(() => {});
      }
      return value;
    })
  );
}
