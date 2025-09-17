import type { AppConfig, Pokemon, Tier } from '../types';
import { sampleWithoutReplacement } from './random';

export function byRegion(p: Pokemon, region: string) {
    return p.regiones
        .map((r) => r.toLowerCase())
        .includes(region.toLowerCase());
}

// Prioridad: S (mayor), luego A, B… Z (menor)
export function tierPriority(t: string): number {
    const u = t.toUpperCase();
    if (u === 'S') return 100;
    const code = u.charCodeAt(0);
    if (code >= 65 && code <= 90) return 90 - (code - 65); // A=90..Z=65
    return 0;
}
export const sortTiersDesc = (tiers: string[]) =>
    [...tiers].sort((a, b) => tierPriority(b) - tierPriority(a));
export const sortTiersAsc = (tiers: string[]) =>
    [...tiers].sort((a, b) => tierPriority(a) - tierPriority(b));

export function normalizeQuota(
    raw: Record<string, number>,
    shopSize: number
): Record<string, number> {
    const q: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw))
        q[k.toUpperCase()] = Math.max(0, Math.floor(v || 0));
    let tiers = Object.keys(q);
    if (tiers.length === 0) return { C: shopSize };
    let sum = tiers.reduce((s, t) => s + (q[t] || 0), 0);
    if (sum === shopSize) return q;
    if (sum > shopSize) {
        let over = sum - shopSize;
        for (const t of sortTiersAsc(tiers)) {
            if (over <= 0) break;
            const take = Math.min(over, q[t]);
            q[t] -= take;
            over -= take;
        }
    } else {
        const deficit = shopSize - sum;
        const lowest = sortTiersAsc(tiers)[0];
        q[lowest] = (q[lowest] || 0) + deficit;
    }
    for (const t of Object.keys(q)) if (q[t] <= 0) delete q[t];
    return q;
}

export function buildShopForRegion(
    all: Pokemon[],
    region: string,
    cfg: AppConfig,
    purchasedIds: Set<number>
): Pokemon[] {
    const pool = all.filter((p) => byRegion(p, region));
    const effQuota = normalizeQuota(cfg.quota, cfg.shopSize);
    const tiersDesc = sortTiersDesc(Object.keys(effQuota));
    const result: (Pokemon & { __uid?: string })[] = [];

    for (const tier of tiersDesc) {
        const need = effQuota[tier] || 0;
        if (need <= 0) continue;

        // Pool por tier
        let tierPool = pool
            .filter((p) => p.tier.toUpperCase() === tier)
            .map((p) => ({ ...p } as Pokemon & { __uid?: string }));

        // Rellenar con clones si faltan (pueden compartir misma id)
        while (tierPool.length < need && tierPool.length > 0) {
            const sample =
                tierPool[Math.floor(Math.random() * tierPool.length)];
            tierPool.push({ ...sample });
        }

        if (!cfg.allowDuplicates) {
            const usedIds = new Set(result.map((r) => r?.id));
            const seen = new Set<number>();

            tierPool.forEach((p) => {
                const dupInside = seen.has(p.id);
                const already = usedIds.has(p.id) || purchasedIds.has(p.id);
                if (dupInside || already) {
                    p.id = -1; // marcar hueco vacío
                } else {
                    seen.add(p.id);
                }
            });
            // ⚠️ No filtramos los -1: queremos que cuenten como huecos visibles
        }

        tierPool = tierPool.map((p) =>
            p.__uid ? p : { ...p, __uid: crypto.randomUUID() }
        );

        // Comparador: -1 se compara por UID; el resto por id
        const equals = (
            a: Pokemon & { __uid?: string },
            b: Pokemon & { __uid?: string }
        ) => {
            const aIsHole = a?.id === -1;
            const bIsHole = b?.id === -1;
            if (aIsHole && bIsHole) return a.__uid === b.__uid; // huecos distintos
            return a?.id === b?.id; // unicidad por especie
        };

        const count = Math.min(need, tierPool.length);
        if (count > 0) {
            // ⬅️ Prioriza reales; rellena con huecos si no alcanza
            const realPool = tierPool.filter((p) => p.id !== -1);
            const holePool = tierPool.filter((p) => p.id === -1);

            const picked: (Pokemon & { __uid?: string })[] = [];

            // 1) Reales primero
            const takeReal = Math.min(count, realPool.length);
            if (takeReal > 0) {
                const pickedReal = sampleWithoutReplacement(
                    realPool,
                    takeReal,
                    equals,
                    cfg.allowDuplicates ? [] : result
                );
                picked.push(...pickedReal);
            }

            // 2) Si faltan, rellenar con huecos (-1)
            const remaining = count - picked.length;
            if (remaining > 0 && holePool.length > 0) {
                const exclude = cfg.allowDuplicates
                    ? picked
                    : result.concat(picked);
                const pickedHoles = sampleWithoutReplacement(
                    holePool,
                    Math.min(remaining, holePool.length),
                    equals,
                    exclude
                );
                picked.push(...pickedHoles);
            }

            // picked ya trae __uid; propagar a result
            result.push(...picked);
        }
    }

    return result;
}

export function findRerollCandidate(
    all: Pokemon[],
    region: string,
    tier: Tier,
    usedIds: Set<number>,
    purchasedIds: Set<number>,
    forbidId: number | null,
    cfg: AppConfig
): Pokemon | null {
    const t = String(tier).toUpperCase();
    let pool = all.filter(
        (p) => byRegion(p, region) && p.tier.toUpperCase() === t
    );
    if (!cfg.includePurchasedInRerollPool)
        pool = pool.filter((p) => !purchasedIds.has(p.id));
    if (!cfg.allowDuplicates) pool = pool.filter((p) => !usedIds.has(p.id));
    if (forbidId != null) pool = pool.filter((p) => p.id !== forbidId); // no rerollear al mismo
    if (pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)];
}
