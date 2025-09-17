export function shuffleInPlace<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

export function sampleWithoutReplacement<T>(
    pool: T[],
    count: number,
    isEqual?: (a: T, b: T) => boolean,
    exclude: T[] = []
): T[] {
    const out: T[] = [];
    const copy = pool.slice();
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    const eq = isEqual ?? ((a, b) => a === b);
    for (const item of copy) {
        if (out.length >= count) break;
        const inExclude = exclude.some((x) => eq(x, item));
        const inOut = out.some((x) => eq(x, item));
        if (!inExclude && !inOut) out.push(item);
    }
    return out;
}
