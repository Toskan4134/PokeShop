import type { AppConfig, Pokemon, Tier } from '../types';
import { sampleWithoutReplacement } from './random';

// ================= Utilidades Base =================

// Verifica si un pokémon pertenece a una región específica
export function byRegion(pokemon: Pokemon, region: string): boolean {
    return pokemon.regiones
        .map((r) => r.toLowerCase())
        .includes(region.toLowerCase());
}

// Calcula la prioridad numérica de un tier (S=mayor, Z=menor)
export function tierPriority(tier: string): number {
    const upperTier = tier.toUpperCase();
    if (upperTier === 'S') return 100;

    const charCode = upperTier.charCodeAt(0);
    if (charCode >= 65 && charCode <= 90) {
        return 90 - (charCode - 65); // A=90, B=89, ..., Z=65
    }
    return 0;
}

// Ordena tiers de mayor a menor prioridad (S, A, B, C...)
export const sortTiersDesc = (tiers: string[]) =>
    [...tiers].sort((a, b) => tierPriority(b) - tierPriority(a));

// Ordena tiers de menor a mayor prioridad (Z, Y, X... C, B, A, S)
export const sortTiersAsc = (tiers: string[]) =>
    [...tiers].sort((a, b) => tierPriority(a) - tierPriority(b));

// ================= Normalización de Cuotas =================

// Normaliza las cuotas de tier para ajustarse al tamaño de la tienda
export function normalizeQuota(
    rawQuota: Record<string, number>,
    shopSize: number
): Record<string, number> {
    // Normalizar claves y valores
    const quota: Record<string, number> = {};
    for (const [tier, count] of Object.entries(rawQuota)) {
        quota[tier.toUpperCase()] = Math.max(0, Math.floor(count || 0));
    }

    const tiers = Object.keys(quota);
    if (tiers.length === 0) return { C: shopSize };

    const totalAssigned = tiers.reduce((sum, tier) => sum + (quota[tier] || 0), 0);

    if (totalAssigned === shopSize) {
        return quota;
    }

    if (totalAssigned > shopSize) {
        // Reducir cuotas empezando por los tiers de menor prioridad
        let excess = totalAssigned - shopSize;
        for (const tier of sortTiersAsc(tiers)) {
            if (excess <= 0) break;
            const reduction = Math.min(excess, quota[tier]);
            quota[tier] -= reduction;
            excess -= reduction;
        }
    } else {
        // Añadir el déficit al tier de menor prioridad
        const deficit = shopSize - totalAssigned;
        const lowestTier = sortTiersAsc(tiers)[0];
        quota[lowestTier] = (quota[lowestTier] || 0) + deficit;
    }

    // Eliminar tiers con cuota 0
    for (const tier of Object.keys(quota)) {
        if (quota[tier] <= 0) delete quota[tier];
    }

    return quota;
}

// ================= Sistema de Mínimos y Pesos =================

// Normaliza cuotas mínimas: asegura enteros >= 0, NO ajusta al tamaño de tienda
function normalizeMinQuota(
    rawMinQuota: Record<string, number> | undefined
): Record<string, number> {
    const minQuota: Record<string, number> = {};
    if (!rawMinQuota) return minQuota;

    for (const [tier, count] of Object.entries(rawMinQuota)) {
        const normalizedTier = String(tier).toUpperCase();
        const normalizedCount = Math.max(0, Math.floor(Number(count) || 0));
        if (normalizedCount > 0) {
            minQuota[normalizedTier] = normalizedCount;
        }
    }
    return minQuota;
}

// Normaliza pesos de tier y garantiza valores válidos
function normalizeWeights(
    rawWeights: Record<string, number> | undefined
): Record<string, number> {
    const defaultWeights = { C: 40, B: 30, A: 20, S: 10 };
    const merged = { ...defaultWeights, ...(rawWeights || {}) };
    const weights: Record<string, number> = {};
    let totalWeight = 0;

    for (const [tier, weight] of Object.entries(merged)) {
        const normalizedTier = String(tier).toUpperCase();
        const normalizedWeight = Math.max(0, Number(weight) || 0);
        weights[normalizedTier] = normalizedWeight;
        totalWeight += normalizedWeight;
    }

    // Si todos los pesos son 0, usar valores por defecto
    if (totalWeight === 0) {
        return { C: 40, B: 30, A: 20, S: 10 };
    }

    return weights;
}

// Selecciona un tier aleatorio basado en pesos probabilísticos
function pickWeightedTier(
    candidateTiers: string[],
    weights: Record<string, number>
): string {
    const tierWeights = candidateTiers.map((tier) => Math.max(0, weights[tier] || 0));
    const totalWeight = tierWeights.reduce((sum, weight) => sum + weight, 0);

    if (totalWeight <= 0) {
        // Si no hay pesos válidos, elegir el tier de mayor prioridad
        return sortTiersDesc(candidateTiers)[0];
    }

    let randomValue = Math.random() * totalWeight;
    for (let i = 0; i < candidateTiers.length; i++) {
        randomValue -= tierWeights[i];
        if (randomValue <= 0) return candidateTiers[i];
    }

    return candidateTiers[candidateTiers.length - 1];
}

// Calcula la cantidad de pokémon por tier: primero mínimos garantizados, luego distribución por pesos
function computeTierCounts(
    shopSize: number,
    minQuota: Record<string, number>,
    weights: Record<string, number>
): Record<string, number> {
    const counts: Record<string, number> = { ...minQuota };
    const allTiers = Array.from(
        new Set([...Object.keys(minQuota), ...Object.keys(weights)])
    );

    const guaranteedTotal = Object.values(minQuota).reduce((sum, count) => sum + count, 0);
    const remainingSlots = Math.max(0, shopSize - guaranteedTotal);

    // Distribuir slots restantes usando pesos probabilísticos
    for (let i = 0; i < remainingSlots; i++) {
        const selectedTier = pickWeightedTier(allTiers, weights);
        counts[selectedTier] = (counts[selectedTier] || 0) + 1;
    }

    return counts;
}

// ================= Generación de Tienda =================

/**
 * Genera la tienda de pokémon para una región específica.
 *
 * Características:
 * - Respeta cuotas mínimas y distribuye el resto usando pesos de tier
 * - Ordena pokémon de mejor a peor tier (S → A → B → C...)
 * - Evita duplicados si allowDuplicates=false
 * - Excluye pokémon comprados si includePurchasedInRerollPool=false
 * - Rellena con huecos vacíos (id = -1) si no hay suficientes pokémon
 */

export function buildShopForRegion(
    allPokemon: Pokemon[],
    region: string,
    config: AppConfig,
    purchasedIds: Set<number>
): Pokemon[] {
    // Filtrar pokémon disponibles en la región
    const regionPool = allPokemon.filter((pokemon) => byRegion(pokemon, region));

    // Calcular distribución de tiers
    const minQuota = normalizeMinQuota(config.quota);
    const weights = normalizeWeights(config.tierWeights);
    const tierCounts = computeTierCounts(config.shopSize, minQuota, weights);

    // Procesar tiers de mayor a menor prioridad (S → A → B → C...)
    const tiersByPriority = sortTiersDesc(Object.keys(tierCounts));
    const shopResult: (Pokemon & { __uid?: string })[] = [];

    for (const currentTier of tiersByPriority) {
        const requiredCount = Math.max(0, tierCounts[currentTier] || 0);
        if (requiredCount <= 0) continue;

        // Crear pool de pokémon para este tier
        let tierPool = regionPool
            .filter((pokemon) => String(pokemon.tier).toUpperCase() === currentTier)
            .map((pokemon) => ({ ...pokemon } as Pokemon & { __uid?: string }));

        // Excluir pokémon ya comprados si está configurado así
        if (!config.includePurchasedInRerollPool) {
            tierPool = tierPool.filter((pokemon) => !purchasedIds.has(pokemon.id));
        }

        // Manejar duplicados según configuración
        if (config.allowDuplicates) {
            // Clonar pokémon existentes si se necesitan más
            while (tierPool.length < requiredCount && tierPool.length > 0) {
                const randomPokemon = tierPool[Math.floor(Math.random() * tierPool.length)];
                tierPool.push({ ...randomPokemon });
            }
        } else {
            // Marcar duplicados como huecos
            const usedIds = new Set(shopResult.map((pokemon) => pokemon?.id));
            const seenIds = new Set<number>();

            tierPool.forEach((pokemon) => {
                const isDuplicateInTier = seenIds.has(pokemon.id);
                const isAlreadyInShop = usedIds.has(pokemon.id);

                if (isDuplicateInTier || isAlreadyInShop) {
                    pokemon.id = -1; // Marcar como hueco
                } else {
                    seenIds.add(pokemon.id);
                }
            });
        }

        // Asignar UIDs únicos para distinguir huecos
        tierPool = tierPool.map((pokemon) =>
            pokemon.__uid ? pokemon : { ...pokemon, __uid: crypto.randomUUID() }
        );

        // Función para comparar pokémon (incluyendo huecos)
        const pokemonEquals = (
            a: Pokemon & { __uid?: string },
            b: Pokemon & { __uid?: string }
        ) => {
            const isAHole = a?.id === -1;
            const isBHole = b?.id === -1;
            return isAHole && isBHole ? a.__uid === b.__uid : a?.id === b?.id;
        };

        // Seleccionar pokémon para la tienda
        if (requiredCount > 0) {
            const realPokemon = tierPool.filter((pokemon) => pokemon.id !== -1);
            const holePokemon = tierPool.filter((pokemon) => pokemon.id === -1);
            const selectedPokemon: (Pokemon & { __uid?: string })[] = [];

            // Priorizar pokémon reales
            const realCount = Math.min(requiredCount, realPokemon.length);
            if (realCount > 0) {
                const pickedReal = sampleWithoutReplacement(
                    realPokemon,
                    realCount,
                    pokemonEquals,
                    shopResult
                );
                selectedPokemon.push(...pickedReal);
            }

            // Completar con huecos si es necesario
            const remainingSlots = requiredCount - selectedPokemon.length;
            if (remainingSlots > 0) {
                const pickedHoles = sampleWithoutReplacement(
                    holePokemon,
                    Math.min(remainingSlots, holePokemon.length),
                    pokemonEquals,
                    shopResult.concat(selectedPokemon)
                );
                selectedPokemon.push(...pickedHoles);
            }

            // Crear huecos sintéticos si aún faltan slots
            while (selectedPokemon.length < requiredCount) {
                selectedPokemon.push({
                    id: -1,
                    nombre: '—',
                    tier: currentTier,
                    precio: 0,
                    regiones: [region],
                    __uid: crypto.randomUUID(),
                });
            }

            shopResult.push(...selectedPokemon);
        }
    }

    return shopResult;
}

// ================= Sistema de Reroll =================

// Busca un pokémon candidato válido para reemplazar en un reroll
export function findRerollCandidate(
    allPokemon: Pokemon[],
    region: string,
    tier: Tier,
    usedIds: Set<number>,
    purchasedIds: Set<number>,
    forbiddenId: number | null,
    config: AppConfig
): Pokemon | null {
    const targetTier = String(tier).toUpperCase();

    // Filtrar candidatos por región y tier
    let candidatePool = allPokemon.filter(
        (pokemon) => byRegion(pokemon, region) && pokemon.tier.toUpperCase() === targetTier
    );

    // Excluir pokémon comprados si está configurado así
    if (!config.includePurchasedInRerollPool) {
        candidatePool = candidatePool.filter((pokemon) => !purchasedIds.has(pokemon.id));
    }

    // Excluir duplicados si no están permitidos
    if (!config.allowDuplicates) {
        candidatePool = candidatePool.filter((pokemon) => !usedIds.has(pokemon.id));
    }

    // Excluir el pokémon actual que se está rerolleando
    if (forbiddenId != null) {
        candidatePool = candidatePool.filter((pokemon) => pokemon.id !== forbiddenId);
    }

    // Si no hay candidatos válidos, retornar null
    if (candidatePool.length === 0) return null;

    // Seleccionar candidato aleatorio
    return candidatePool[Math.floor(Math.random() * candidatePool.length)];
}
