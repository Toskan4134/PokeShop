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

// ================= Fallback de Tiers =================

// Encuentra tiers alternativos cuando no hay Pokémon disponibles en el tier original
function findFallbackTiers(
    originalTier: string,
    tierWeights: Record<string, number>
): string[] {
    const fallbackTiers: string[] = [];
    const originalPriority = tierPriority(originalTier);

    // Obtener todos los tiers de la configuración, excluyendo el tier original
    const allConfigTiers = Object.keys(tierWeights).filter(tier =>
        tier.toUpperCase() !== originalTier.toUpperCase()
    );

    // Primero buscar tiers inferiores (menor prioridad): C, D, E...
    const lowerTiers = allConfigTiers
        .filter(tier => tierPriority(tier) < originalPriority)
        .sort((a, b) => tierPriority(b) - tierPriority(a)); // Mayor a menor prioridad (C antes que D)

    // Luego buscar tiers superiores (mayor prioridad): A, S
    const higherTiers = allConfigTiers
        .filter(tier => tierPriority(tier) > originalPriority)
        .sort((a, b) => tierPriority(a) - tierPriority(b)); // Menor a mayor prioridad (A antes que S)

    fallbackTiers.push(...lowerTiers, ...higherTiers);

    return fallbackTiers;
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
    console.log(`[TierFallback] ===== Starting shop generation for region: ${region} =====`);
    console.log(`[TierFallback] TierFallback enabled: ${config.tierFallback}`);
    console.log(`[TierFallback] Shop size: ${config.shopSize}`);
    console.log(`[TierFallback] Purchased IDs: [${Array.from(purchasedIds).join(', ')}]`);

    // Filtrar pokémon disponibles en la región
    const regionPool = allPokemon.filter((pokemon) => byRegion(pokemon, region));
    console.log(`[TierFallback] Total Pokémon in region ${region}: ${regionPool.length}`);

    // Calcular distribución de tiers
    const minQuota = normalizeMinQuota(config.quota);
    const weights = normalizeWeights(config.tierWeights);
    const tierCounts = computeTierCounts(config.shopSize, minQuota, weights);

    console.log(`[TierFallback] Requested tier counts:`, tierCounts);
    console.log(`[TierFallback] Tier weights:`, weights);

    // Log available Pokémon by tier in this region
    const availableByTier = regionPool.reduce((acc, pokemon) => {
        const tier = pokemon.tier.toUpperCase();
        acc[tier] = (acc[tier] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);
    console.log(`[TierFallback] Available Pokémon by tier in ${region}:`, availableByTier);

    // Procesar tiers de mayor a menor prioridad (S → A → B → C...)
    const tiersByPriority = sortTiersDesc(Object.keys(tierCounts));
    const shopResult: (Pokemon & { __uid?: string })[] = [];

    for (const currentTier of tiersByPriority) {
        const requiredCount = Math.max(0, tierCounts[currentTier] || 0);
        if (requiredCount <= 0) continue;

        console.log(`[TierFallback] Processing tier ${currentTier}, need ${requiredCount} Pokémon`);

        // Función helper para obtener pool de candidatos para un tier específico
        const getCandidatePoolForTier = (searchTier: string) => {
            let pool = regionPool
                .filter((pokemon) => String(pokemon.tier).toUpperCase() === searchTier)
                .map((pokemon) => ({ ...pokemon } as Pokemon & { __uid?: string }));

            console.log(`[TierFallback] Found ${pool.length} ${searchTier} tier Pokémon in region before purchase filter`);

            // Excluir pokémon ya comprados si está configurado así
            if (!config.includePurchasedInRerollPool) {
                const beforeFilter = pool.length;
                pool = pool.filter((pokemon) => !purchasedIds.has(pokemon.id));
                console.log(`[TierFallback] After purchase filter: ${pool.length} ${searchTier} tier Pokémon (removed ${beforeFilter - pool.length})`);
            }

            return pool;
        };

        // Crear pool de pokémon para este tier
        let tierPool = getCandidatePoolForTier(currentTier);

        // Si el tier fallback está habilitado y no hay Pokémon disponibles
        if (config.tierFallback && tierPool.length === 0) {
            console.log(`[TierFallback] No Pokémon available for tier ${currentTier}, starting fallback search`);

            // Buscar tiers alternativos usando la configuración de tierWeights
            const fallbackTiers = findFallbackTiers(currentTier, weights);
            console.log(`[TierFallback] Fallback chain for tier ${currentTier}: ${fallbackTiers.join(' → ')}`);

            // Intentar obtener Pokémon de los tiers alternativos
            for (const fallbackTier of fallbackTiers) {
                console.log(`[TierFallback] Trying fallback tier ${fallbackTier}...`);
                tierPool = getCandidatePoolForTier(fallbackTier);

                // Si encontramos Pokémon en este tier alternativo, salir del bucle
                if (tierPool.length > 0) {
                    console.log(`[TierFallback] SUCCESS: Tier ${currentTier} not available, using tier ${fallbackTier} instead (found ${tierPool.length} candidates)`);
                    break;
                } else {
                    console.log(`[TierFallback] No candidates found in fallback tier ${fallbackTier}`);
                }
            }

            if (tierPool.length === 0) {
                console.log(`[TierFallback] FAILED: No Pokémon found in any fallback tier for ${currentTier}. Tried: ${fallbackTiers.join(', ')}`);
            }
        }

        // Manejar duplicados según configuración
        if (config.allowDuplicates) {
            // Clonar pokémon existentes si se necesitan más
            while (tierPool.length < requiredCount && tierPool.length > 0) {
                const randomPokemon = tierPool[Math.floor(Math.random() * tierPool.length)];
                tierPool.push({ ...randomPokemon });
            }
        } else {
            console.log(`[TierFallback] Applying duplicate filtering for tier ${currentTier} (${tierPool.length} candidates)`);

            // Marcar duplicados como huecos
            const usedIds = new Set(shopResult.map((pokemon) => pokemon?.id));
            const seenIds = new Set<number>();

            console.log(`[TierFallback] Already used IDs in shop: [${Array.from(usedIds).join(', ')}]`);

            tierPool.forEach((pokemon) => {
                const isDuplicateInTier = seenIds.has(pokemon.id);
                const isAlreadyInShop = usedIds.has(pokemon.id);

                if (isDuplicateInTier || isAlreadyInShop) {
                    pokemon.id = -1; // Marcar como hueco
                } else {
                    seenIds.add(pokemon.id);
                }
            });

            // Si después de manejar duplicados no hay Pokémon válidos y tier fallback está habilitado
            const validPokemon = tierPool.filter(pokemon => pokemon.id !== -1);
            console.log(`[TierFallback] After duplicate filtering: ${validPokemon.length} valid Pokémon for tier ${currentTier}`);

            if (config.tierFallback && validPokemon.length === 0) {
                console.log(`[TierFallback] No valid Pokémon for tier ${currentTier} after duplicate filtering, starting fallback search`);

                // Buscar tiers alternativos usando la configuración de tierWeights
                const fallbackTiers = findFallbackTiers(currentTier, weights);
                console.log(`[TierFallback] Duplicate fallback chain for tier ${currentTier}: ${fallbackTiers.join(' → ')}`);

                // Intentar obtener Pokémon de los tiers alternativos
                for (const fallbackTier of fallbackTiers) {
                    console.log(`[TierFallback] Trying duplicate fallback tier ${fallbackTier}...`);
                    let fallbackPool = getCandidatePoolForTier(fallbackTier);

                    // Aplicar filtro de duplicados al pool alternativo
                    const fallbackUsedIds = new Set(shopResult.map((pokemon) => pokemon?.id));
                    const fallbackSeenIds = new Set<number>();

                    fallbackPool.forEach((pokemon) => {
                        const isDuplicateInTier = fallbackSeenIds.has(pokemon.id);
                        const isAlreadyInShop = fallbackUsedIds.has(pokemon.id);

                        if (isDuplicateInTier || isAlreadyInShop) {
                            pokemon.id = -1; // Marcar como hueco
                        } else {
                            fallbackSeenIds.add(pokemon.id);
                        }
                    });

                    const validFallbackPokemon = fallbackPool.filter(pokemon => pokemon.id !== -1);
                    console.log(`[TierFallback] Fallback tier ${fallbackTier} has ${validFallbackPokemon.length} valid Pokémon after duplicate filtering`);

                    if (validFallbackPokemon.length > 0) {
                        console.log(`[TierFallback] SUCCESS: Tier ${currentTier} exhausted after duplicate filtering, using tier ${fallbackTier} instead`);
                        tierPool = fallbackPool;
                        break;
                    } else {
                        console.log(`[TierFallback] No valid candidates found in duplicate fallback tier ${fallbackTier}`);
                    }
                }

                if (tierPool.filter(pokemon => pokemon.id !== -1).length === 0) {
                    console.log(`[TierFallback] FAILED: No valid Pokémon found in any duplicate fallback tier for ${currentTier}. Tried: ${fallbackTiers.join(', ')}`);
                }
            }
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
            const selectedPokemon: (Pokemon & { __uid?: string })[] = [];
            let remainingNeeded = requiredCount;

            // Usar el tierPool actual (que puede ser del tier original o fallback)
            const realPokemon = tierPool.filter((pokemon) => pokemon.id !== -1);
            const realCount = Math.min(remainingNeeded, realPokemon.length);

            if (realCount > 0) {
                const pickedReal = sampleWithoutReplacement(
                    realPokemon,
                    realCount,
                    pokemonEquals,
                    shopResult
                );
                selectedPokemon.push(...pickedReal);
                remainingNeeded -= pickedReal.length;
                console.log(`[TierFallback] Selected ${pickedReal.length} real Pokémon for tier ${currentTier}, still need ${remainingNeeded}`);
            }

            // Si aún necesitamos más Pokémon y tier fallback está habilitado, buscar en más tiers
            if (config.tierFallback && remainingNeeded > 0) {
                console.log(`[TierFallback] Still need ${remainingNeeded} more Pokémon for tier ${currentTier}, searching additional fallback tiers`);

                const fallbackTiers = findFallbackTiers(currentTier, weights);
                const usedTiers = new Set<string>();

                // Si ya usamos un tier de fallback, añadirlo a los usados
                const currentTierUsed = tierPool.some(p => p.id !== -1 && p.tier.toUpperCase() !== currentTier.toUpperCase());
                if (currentTierUsed) {
                    const usedTier = tierPool.find(p => p.id !== -1)?.tier.toUpperCase();
                    if (usedTier) usedTiers.add(usedTier);
                }

                for (const fallbackTier of fallbackTiers) {
                    if (remainingNeeded <= 0 || usedTiers.has(fallbackTier)) continue;

                    console.log(`[TierFallback] Trying additional fallback tier ${fallbackTier} for ${remainingNeeded} more slots...`);
                    let additionalPool = getCandidatePoolForTier(fallbackTier);

                    // Aplicar filtro de duplicados
                    const currentUsedIds = new Set([
                        ...shopResult.map(p => p?.id),
                        ...selectedPokemon.map(p => p?.id)
                    ].filter(id => id !== -1));

                    const additionalSeenIds = new Set<number>();
                    additionalPool.forEach((pokemon) => {
                        const isDuplicateInTier = additionalSeenIds.has(pokemon.id);
                        const isAlreadyUsed = currentUsedIds.has(pokemon.id);

                        if (isDuplicateInTier || isAlreadyUsed) {
                            pokemon.id = -1;
                        } else {
                            additionalSeenIds.add(pokemon.id);
                        }
                    });

                    const validAdditional = additionalPool.filter(pokemon => pokemon.id !== -1);
                    const additionalCount = Math.min(remainingNeeded, validAdditional.length);

                    if (additionalCount > 0) {
                        const pickedAdditional = sampleWithoutReplacement(
                            validAdditional,
                            additionalCount,
                            pokemonEquals,
                            [...shopResult, ...selectedPokemon]
                        );
                        selectedPokemon.push(...pickedAdditional);
                        remainingNeeded -= pickedAdditional.length;
                        usedTiers.add(fallbackTier);
                        console.log(`[TierFallback] Selected ${pickedAdditional.length} additional Pokémon from tier ${fallbackTier}, still need ${remainingNeeded}`);
                    }
                }
            }

            // Completar con huecos si es necesario
            if (remainingNeeded > 0) {
                console.log(`[TierFallback] Creating ${remainingNeeded} empty slots for tier ${currentTier}`);
                for (let i = 0; i < remainingNeeded; i++) {
                    selectedPokemon.push({
                        id: -1,
                        nombre: '—',
                        tier: currentTier,
                        precio: 0,
                        regiones: [region],
                        __uid: crypto.randomUUID(),
                    });
                }
            }

            shopResult.push(...selectedPokemon);
        }
    }

    // Ordenar el resultado final por prioridad de tier (S → A → B → C → D...)
    console.log(`[Shop] Sorting final shop by tier priority...`);
    const sortedShopResult = shopResult.sort((a, b) => {
        // Ordenar por prioridad de tier (mayor prioridad primero)
        const aPriority = tierPriority(a.tier);
        const bPriority = tierPriority(b.tier);
        if (aPriority !== bPriority) return bPriority - aPriority;

        // Si tienen el mismo tier, los Pokémon reales van antes que los huecos
        if (a.id === -1 && b.id !== -1) return 1;
        if (a.id !== -1 && b.id === -1) return -1;

        // Si ambos son huecos o ambos son reales del mismo tier, ordenar por nombre
        if (a.id !== -1 && b.id !== -1) {
            return a.nombre.localeCompare(b.nombre);
        }

        return 0; // Ambos son huecos del mismo tier
    });

    // Log final shop composition
    const finalComposition = sortedShopResult.reduce((acc, pokemon) => {
        if (pokemon.id === -1) {
            acc['EMPTY'] = (acc['EMPTY'] || 0) + 1;
        } else {
            acc[pokemon.tier] = (acc[pokemon.tier] || 0) + 1;
        }
        return acc;
    }, {} as Record<string, number>);

    console.log(`[Shop] Final shop composition after sorting:`, finalComposition);
    console.log(`[Shop] Shop generation completed for region ${region}. Total slots: ${sortedShopResult.length}`);

    return sortedShopResult;
}

// ================= Sistema de Reroll =================

// Verifica si un reroll causaría una degradación de tier
export function wouldRerollCauseTierDowngrade(
    allPokemon: Pokemon[],
    region: string,
    tier: Tier,
    usedIds: Set<number>,
    purchasedIds: Set<number>,
    forbiddenId: number | null,
    config: AppConfig
): { wouldDowngrade: boolean; fallbackTier?: string } {
    if (!config.tierFallback) {
        return { wouldDowngrade: false };
    }

    const targetTier = String(tier).toUpperCase();

    // Función helper para filtrar candidatos por tier
    const getCandidatesForTier = (searchTier: string) => {
        let candidatePool = allPokemon.filter(
            (pokemon) => byRegion(pokemon, region) && pokemon.tier.toUpperCase() === searchTier
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

        return candidatePool;
    };

    // Intentar encontrar candidatos en el tier original
    const candidatePool = getCandidatesForTier(targetTier);

    // Si hay candidatos en el tier original, no habrá degradación
    if (candidatePool.length > 0) {
        return { wouldDowngrade: false };
    }

    // Si no hay candidatos y tier fallback está habilitado, verificar el primer tier de fallback disponible
    const weights = normalizeWeights(config.tierWeights);
    const fallbackTiers = findFallbackTiers(targetTier, weights);

    for (const fallbackTier of fallbackTiers) {
        const fallbackCandidates = getCandidatesForTier(fallbackTier);
        if (fallbackCandidates.length > 0) {
            // Hay candidatos en un tier de fallback - verificar si es una degradación
            const originalPriority = tierPriority(targetTier);
            const fallbackPriority = tierPriority(fallbackTier);

            if (fallbackPriority < originalPriority) {
                return { wouldDowngrade: true, fallbackTier };
            } else {
                return { wouldDowngrade: false, fallbackTier };
            }
        }
    }

    // No hay candidatos en ningún tier
    return { wouldDowngrade: false };
}

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

    // Función helper para filtrar candidatos por tier
    const getCandidatesForTier = (searchTier: string) => {
        let candidatePool = allPokemon.filter(
            (pokemon) => byRegion(pokemon, region) && pokemon.tier.toUpperCase() === searchTier
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

        return candidatePool;
    };

    // Intentar encontrar candidatos en el tier original
    let candidatePool = getCandidatesForTier(targetTier);

    // Si no hay candidatos y el tier fallback está habilitado
    if (candidatePool.length === 0 && config.tierFallback) {
        // Buscar tiers alternativos usando la configuración de tierWeights
        const weights = normalizeWeights(config.tierWeights);
        const fallbackTiers = findFallbackTiers(targetTier, weights);

        // Intentar obtener candidatos de los tiers alternativos
        for (const fallbackTier of fallbackTiers) {
            candidatePool = getCandidatesForTier(fallbackTier);
            if (candidatePool.length > 0) {
                break;
            }
        }
    }

    // Si no hay candidatos válidos, retornar null
    if (candidatePool.length === 0) return null;

    // Seleccionar candidato aleatorio
    return candidatePool[Math.floor(Math.random() * candidatePool.length)];
}
