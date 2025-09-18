import type { AppConfig, Pokemon, Tier } from '../types';
import { sampleWithoutReplacement } from './random';

// ---- Utilidades base ----
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

// ---- Novedad: mínimos + pesos ----

// MinQuota: normaliza claves y asegura enteros >= 0; NO ajusta a shopSize
function normalizeMinQuota(
    raw: Record<string, number> | undefined
): Record<string, number> {
    const out: Record<string, number> = {};
    if (!raw) return out;
    for (const [k, v] of Object.entries(raw)) {
        const K = String(k).toUpperCase();
        const n = Math.max(0, Math.floor(Number(v) || 0));
        if (n > 0) out[K] = n;
    }
    return out;
}

// Pesos: normaliza y garantiza algo razonable si suman 0
function normalizeWeights(
    raw: Record<string, number> | undefined
): Record<string, number> {
    const base = { C: 40, B: 30, A: 20, S: 10 };
    const merged = { ...base, ...(raw || {}) };
    const out: Record<string, number> = {};
    let sum = 0;
    for (const [k, v] of Object.entries(merged)) {
        const K = String(k).toUpperCase();
        const n = Math.max(0, Number(v) || 0);
        out[K] = n;
        sum += n;
    }
    if (sum === 0) {
        // fallback
        return { C: 40, B: 30, A: 20, S: 10 };
    }
    return out;
}

// Elige un tier aleatorio según pesos
function pickWeightedTier(
    candidates: string[],
    weights: Record<string, number>
): string {
    const totals = candidates.map((t) => Math.max(0, weights[t] || 0));
    const sum = totals.reduce((s, n) => s + n, 0);
    if (sum <= 0) {
        // todo 0 → elige el de mayor prioridad
        return sortTiersDesc(candidates)[0];
    }
    let r = Math.random() * sum;
    for (let i = 0; i < candidates.length; i++) {
        r -= totals[i];
        if (r <= 0) return candidates[i];
    }
    return candidates[candidates.length - 1];
}

// Calcula cuántos por tier: primero mínimos, luego pesos para el resto
function computeTierCounts(
    shopSize: number,
    minQuota: Record<string, number>,
    weights: Record<string, number>
): Record<string, number> {
    const counts: Record<string, number> = { ...minQuota };
    const tiersUniverse = Array.from(
        new Set([...Object.keys(minQuota), ...Object.keys(weights)])
    );

    const guaranteed = Object.values(minQuota).reduce((s, n) => s + n, 0);
    let remaining = Math.max(0, shopSize - guaranteed);

    if (remaining > 0) {
        // repartimos 1 a 1 por muestreo ponderado
        for (let i = 0; i < remaining; i++) {
            const t = pickWeightedTier(tiersUniverse, weights);
            counts[t] = (counts[t] || 0) + 1;
        }
    }
    return counts;
}

// ---- Generación de tienda con huecos y reglas existentes ----

/**
 * Genera la tienda para una región:
 * - Respeta mínimos (quota) y rellena el resto con pesos (tierWeights).
 * - Ordena por mejor→peor tier.
 * - Evita duplicados si allowDuplicates=false.
 * - Excluye comprados del pool si includePurchasedInRerollPool=false.
 * - Si falta stock en un tier, rellena con huecos (id = -1) manteniendo tamaño.
 */

export function buildShopForRegion(
    all: Pokemon[],
    region: string,
    cfg: AppConfig,
    purchasedIds: Set<number>
): Pokemon[] {
    const regionPool = all.filter((p) => byRegion(p, region));

    // 1) mínimos y pesos
    const minQuota = normalizeMinQuota(cfg.quota);
    const weights = normalizeWeights(cfg.tierWeights);
    const counts = computeTierCounts(cfg.shopSize, minQuota, weights);

    // 2) iterar por tiers de mayor a menor prioridad
    const tiersDesc = sortTiersDesc(Object.keys(counts));
    const result: (Pokemon & { __uid?: string })[] = [];

    for (const tier of tiersDesc) {
        const need = Math.max(0, counts[tier] || 0);
        if (need <= 0) continue;

        // Pool por tier
        let tierPool = regionPool
            .filter((p) => String(p.tier).toUpperCase() === tier)
            .map((p) => ({ ...p } as Pokemon & { __uid?: string }));

        // Excluir comprados si así se configuró
        if (!cfg.includePurchasedInRerollPool) {
            tierPool = tierPool.filter((p) => !purchasedIds.has(p.id));
        }

        // Si permiten duplicados y hay pocos, se puede clonar para alcanzar need
        if (cfg.allowDuplicates) {
            while (tierPool.length < need && tierPool.length > 0) {
                const sample =
                    tierPool[Math.floor(Math.random() * tierPool.length)];
                tierPool.push({ ...sample });
            }
        }

        // Si NO permiten duplicados, marcaremos como huecos los sobrantes
        if (!cfg.allowDuplicates) {
            const usedIds = new Set(result.map((r) => r?.id));
            const seen = new Set<number>();
            tierPool.forEach((p) => {
                const dupInside = seen.has(p.id);
                const already = usedIds.has(p.id);
                if (dupInside || already) {
                    p.id = -1; // marcar hueco
                } else {
                    seen.add(p.id);
                }
            });
        }

        // Asignar UID a huecos para distinguirlos
        tierPool = tierPool.map((p) =>
            p.__uid ? p : { ...p, __uid: crypto.randomUUID() }
        );

        // Comparador: -1 por uid; los demás por id
        const equals = (
            a: Pokemon & { __uid?: string },
            b: Pokemon & { __uid?: string }
        ) => {
            const aHole = a?.id === -1;
            const bHole = b?.id === -1;
            return aHole && bHole ? a.__uid === b.__uid : a?.id === b?.id;
        };

        // Seleccionar hasta 'need' elementos priorizando reales y luego huecos
        if (need > 0) {
            const realPool = tierPool.filter((p) => p.id !== -1);
            const holePool = tierPool.filter((p) => p.id === -1);

            const picked: (Pokemon & { __uid?: string })[] = [];

            const takeReal = Math.min(need, realPool.length);
            if (takeReal > 0) {
                const pickedReal = sampleWithoutReplacement(
                    realPool,
                    takeReal,
                    equals,
                    result
                );
                picked.push(...pickedReal);
            }

            const remaining = need - picked.length;
            if (remaining > 0) {
                // si no hay suficientes reales, intentamos huecos (-1) para completar tamaño
                const pickedHoles = sampleWithoutReplacement(
                    holePool,
                    Math.min(remaining, holePool.length),
                    equals,
                    result.concat(picked)
                );
                picked.push(...pickedHoles);
            }

            // Si aún faltan (pool vacío), creamos huecos sintéticos
            while (picked.length < need) {
                picked.push({
                    id: -1,
                    nombre: '—',
                    tier,
                    precio: 0,
                    regiones: [region],
                    __uid: crypto.randomUUID(),
                });
            }

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
