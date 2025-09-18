import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
    DEFAULT_CONFIG,
    DEFAULT_POKEMON,
    loadConfig,
    loadPokemonData,
} from '../lib/config';
import { buildShopForRegion, findRerollCandidate } from '../lib/storeLogic';
import type {
    AppConfig,
    HistoryEvent,
    Pokemon,
    PurchaseItem,
    ShopPokemon,
    Snapshot,
    Tier,
} from '../types';

// ===== Configuración interna =====
const UNDO_LIMIT = 20; // niveles de deshacer
const FLASH_MS = 2000; // duración del aviso "No hay pokémon ..."
const STORAGE_KEY = 'pokeshop-state-v12';

// Evita solapamientos de temporizadores de "slot agotado"
// key = `${region}:${index}`
const exhaustedTimers = new Map<string, number>();
// Clave estable para cache regional dentro de shopByIndex sin añadir nuevas propiedades
function regionKeyFor(index: number): number {
    return -(index + 1); // evita colisión con shopIdx >= 0
}

export type ShopState = {
    cfg: AppConfig | null;
    data: Pokemon[];
    regions: string[];
    currentRegionIndex: number; // región activa (lo que ves)
    selectedRegionIndex: number; // región seleccionada (no aplica hasta pulsar Aplicar/Actualizar)
    selectedShopIndex: number; // índice para controlar la recarga automática de tienda
    lastShopIndex: number; // índice previo de recarga automática de tienda
    visitedRegions: string[]; // regiones ya establecidas (con tienda fijada)
    shop: ShopPokemon[]; // tienda visible de la región activa
    shopByIndex: Record<number, ShopPokemon[]>; // persistente por indice tienda
    // 🔁 Rerolls ahora son GLOBALES
    rerollsUsedGlobal: number;
    money: number; // persistente
    history: HistoryEvent[]; // persistente
    purchases: PurchaseItem[]; // persistente
    undoStack: Snapshot[]; // pila de snapshots para deshacer

    // acciones
    bootstrap: () => Promise<void>;
    selectRegionIndex: (i: number) => void;
    nextSelectedRegion: () => void;
    prevSelectedRegion: () => void;
    applySelectedRegionAndRefresh: () => void;
    refresh: () => void;
    addMoney: (amount: number) => void;
    buyAt: (index: number) => void;
    rerollAt: (index: number) => void;
    undoLast: () => void;
    resetAll: () => Promise<void>;
};

function snapshotOf(s: ShopState): Snapshot {
    return {
        currentRegionIndex: s.currentRegionIndex,
        selectedRegionIndex: s.selectedRegionIndex,
        selectedShopIndex: s.selectedShopIndex,
        shop: JSON.parse(JSON.stringify(s.shop)),
        shopByIndex: JSON.parse(JSON.stringify(s.shopByIndex)),
        // compatibilidad con shape antiguo del Snapshot
        rerollsUsedGlobal: s.rerollsUsedGlobal,
        money: s.money,
        purchases: JSON.parse(JSON.stringify(s.purchases)),
        history: JSON.parse(JSON.stringify(s.history)),
    };
}

export const useShopStore = create<ShopState>()(
    persist(
        (set, get) => ({
            cfg: null,
            data: [],
            regions: [],
            currentRegionIndex: 0,
            selectedRegionIndex: 0,
            selectedShopIndex: 0,
            lastShopIndex: 0,
            visitedRegions: [],
            shop: [],
            shopByIndex: {},
            rerollsUsedGlobal: 0,
            money: 0,
            history: [],
            purchases: [],
            undoStack: [],

            // ================= Bootstrap =================
            bootstrap: async () => {
                try {
                    const cfg = await loadConfig();
                    const data = await loadPokemonData(cfg);
                    const regions = cfg.regionsOrder.length
                        ? cfg.regionsOrder
                        : ['Kanto'];
                    const persistedIdx = Math.min(
                        Math.max(0, get().currentRegionIndex || 0),
                        regions.length - 1
                    );
                    const region = regions[persistedIdx];
                    const shopIdx = Math.floor(
                        persistedIdx / (cfg.shopRefreshEveryRegions ?? 1)
                    );

                    // 1) Intentar snapshot por región
                    const rk = regionKeyFor(persistedIdx);
                    const existingRegionShop = get().shopByIndex[rk];

                    // 2) Si no hay snapshot por región, intentar canónica por grupo
                    const existingGroupShop = get().shopByIndex[shopIdx];

                    const purchasedIds = new Set<number>(
                        get().purchases.map((p) => p.pokemonId)
                    );

                    const shop =
                        (existingRegionShop &&
                            existingRegionShop.length &&
                            existingRegionShop) ||
                        (existingGroupShop &&
                            existingGroupShop.length &&
                            existingGroupShop) ||
                        (buildShopForRegion(
                            data,
                            region,
                            cfg,
                            purchasedIds
                        ) as ShopPokemon[]);

                    // visited = claves conocidas + región activa
                    const visitedSet = new Set<string>(
                        get().visitedRegions ||
                            Object.keys(get().shopByIndex || {})
                    );
                    visitedSet.add(region);

                    set({
                        cfg,
                        data,
                        regions,
                        currentRegionIndex: persistedIdx,
                        selectedRegionIndex: persistedIdx,
                        shop,
                        shopByIndex: {
                            ...get().shopByIndex,
                            [shopIdx]: shop,
                            [rk]: shop,
                        },
                        visitedRegions: Array.from(visitedSet),
                        rerollsUsedGlobal: get().rerollsUsedGlobal ?? 0,
                    });
                } catch (e: any) {
                    const cfg = DEFAULT_CONFIG;
                    const data = DEFAULT_POKEMON;
                    const regions = cfg.regionsOrder.length
                        ? cfg.regionsOrder
                        : ['Kanto'];
                    const region = regions[0];
                    const purchasedIds = new Set<number>(
                        get().purchases.map((p) => p.pokemonId)
                    );
                    const shop = buildShopForRegion(
                        data,
                        region,
                        cfg,
                        purchasedIds
                    ) as ShopPokemon[];
                    set({
                        cfg,
                        data,
                        regions,
                        currentRegionIndex: 0,
                        selectedRegionIndex: 0,
                        selectedShopIndex: 0,
                        lastShopIndex: 0,
                        shop,
                        shopByIndex: { [0]: shop },
                        visitedRegions: [region],
                        rerollsUsedGlobal: 0,
                    });
                }
            },

            // ================= Selección de región =================
            selectRegionIndex: (i) => {
                const s = get();
                if (!s.cfg) return;
                if (i < 0 || i >= s.regions.length) return;
                set({
                    selectedRegionIndex: i,
                    selectedShopIndex: Math.floor(
                        i / (s.cfg.shopRefreshEveryRegions ?? 1)
                    ),
                });
                console.log(i % (s.cfg.shopRefreshEveryRegions ?? 1));
            },
            nextSelectedRegion: () => {
                const s = get();
                if (s.selectedRegionIndex < s.regions.length - 1)
                    set({
                        selectedRegionIndex: s.selectedRegionIndex + 1,
                        selectedShopIndex: Math.floor(
                            (s.selectedRegionIndex + 1) /
                                (s.cfg?.shopRefreshEveryRegions ?? 1)
                        ),
                    });
            },
            prevSelectedRegion: () => {
                const s = get();
                if (s.selectedRegionIndex > 0)
                    set({
                        selectedRegionIndex: s.selectedRegionIndex - 1,
                        selectedShopIndex: Math.floor(
                            (s.selectedRegionIndex - 1) /
                                (s.cfg?.shopRefreshEveryRegions ?? 1)
                        ),
                    });
            },

            applySelectedRegionAndRefresh: () => {
                const s = get();
                if (!s.cfg) return;
                // Snapshot para deshacer
                set((st) => ({
                    undoStack: [snapshotOf(st), ...st.undoStack].slice(
                        0,
                        UNDO_LIMIT
                    ),
                }));

                const regionIdx = s.selectedRegionIndex;
                const shopIdx = s.selectedShopIndex;
                const lastShopIdx = s.lastShopIndex;
                const targetRegion = s.regions[regionIdx];

                const rk = regionKeyFor(regionIdx);
                const visited = new Set<string>(s.visitedRegions);
                const isNewRegionName = !visited.has(targetRegion);

                const purchasedIds = new Set<number>(
                    s.purchases.map((p) => p.pokemonId)
                );

                // 1) Si ya existe snapshot por región, úsalo SIEMPRE (objetivo: “cuando vuelva, que sea la misma”)
                let newShop = (s.shopByIndex[rk] ?? []) as ShopPokemon[];

                // 2) Si NO existe snapshot por región, aplicamos la lógica actual:
                //    - si cambia el shopIdx (ha pasado el umbral N) => (re)genera
                //    - si no, usa la tienda canónica del grupo (o genera si no existe)
                if (!newShop.length) {
                    if (lastShopIdx !== shopIdx) {
                        newShop = buildShopForRegion(
                            s.data,
                            targetRegion,
                            s.cfg,
                            purchasedIds
                        ) as ShopPokemon[];
                    } else {
                        newShop = (s.shopByIndex[shopIdx] ??
                            []) as ShopPokemon[];
                        if (!newShop.length) {
                            newShop = buildShopForRegion(
                                s.data,
                                targetRegion,
                                s.cfg,
                                purchasedIds
                            ) as ShopPokemon[];
                        }
                    }
                }

                // --- Rerolls globales (igual que ahora) ---
                let nextRerollsUsed = s.rerollsUsedGlobal;
                if (isNewRegionName) {
                    visited.add(targetRegion);
                    const uniqueCount = visited.size;
                    const rrEvery = s.cfg.rerollRechargeEveryRegions;
                    if (
                        (rrEvery > 0 && uniqueCount % rrEvery === 1) ||
                        rrEvery === 1
                    ) {
                        nextRerollsUsed = 0;
                    }
                }

                const groupSize = s.cfg.shopRefreshEveryRegions ?? 1;
                const groupStart =
                    Math.floor(regionIdx / groupSize) * groupSize;
                const groupEnd = Math.min(
                    groupStart + groupSize - 1,
                    s.regions.length - 1
                );

                set((st) => {
                    const nextShopByIndex = {
                        ...st.shopByIndex,
                        [shopIdx]: newShop,
                    };
                    for (let i = groupStart; i <= groupEnd; i++) {
                        nextShopByIndex[regionKeyFor(i)] = newShop;
                    }
                    return {
                        currentRegionIndex: regionIdx,
                        lastShopIndex: shopIdx,
                        shop: newShop,
                        shopByIndex: nextShopByIndex,
                        visitedRegions: Array.from(visited),
                        rerollsUsedGlobal: nextRerollsUsed,
                        history: [
                            {
                                id: crypto.randomUUID(),
                                ts: new Date().toISOString(),
                                type: 'refresh',
                                message: `Región activa: ${targetRegion}`,
                            },
                            ...st.history,
                        ],
                    };
                });
                console.log(
                    `Aplicada región ${targetRegion} con grupos ${groupStart}-${groupEnd} sincronizados`
                );
            },

            // ================= Refresh manual =================
            refresh: () => {
                const s = get();
                if (!s.cfg) return;
                const activeRegion = s.regions[s.currentRegionIndex];
                const shopIdx = s.selectedShopIndex;
                const selectedRegion = s.regions[s.selectedRegionIndex];
                const purchasedIds = new Set<number>(
                    s.purchases.map((p) => p.pokemonId)
                );
                if (activeRegion !== selectedRegion) {
                    get().applySelectedRegionAndRefresh();
                    return;
                }
                set((st) => ({
                    undoStack: [snapshotOf(st), ...st.undoStack].slice(
                        0,
                        UNDO_LIMIT
                    ),
                }));
                const shop = buildShopForRegion(
                    s.data,
                    activeRegion,
                    s.cfg,
                    purchasedIds
                ) as ShopPokemon[];
                const nextUsed = s.cfg.rerollResetOnRefresh
                    ? 0
                    : s.rerollsUsedGlobal;
                // Al refrescar manualmente, sí se permite regenerar la tienda actual
                const groupSize = s.cfg.shopRefreshEveryRegions ?? 1;
                const groupStart =
                    Math.floor(s.currentRegionIndex / groupSize) * groupSize;
                const groupEnd = Math.min(
                    groupStart + groupSize - 1,
                    s.regions.length - 1
                );

                set((st) => {
                    // Claves a actualizar: canónica del grupo + todos los snapshots de región del grupo
                    const nextShopByIndex = {
                        ...st.shopByIndex,
                        [shopIdx]: shop,
                    };
                    let allRegions = [];
                    for (let i = groupStart; i <= groupEnd; i++) {
                        const rk = regionKeyFor(i);
                        nextShopByIndex[rk] = shop;
                        allRegions.push(st.regions[i]);
                    }
                    return {
                        shop,
                        shopByIndex: nextShopByIndex,
                        rerollsUsedGlobal: nextUsed,
                        history: [
                            {
                                id: crypto.randomUUID(),
                                ts: new Date().toISOString(),
                                type: 'refresh',
                                message: `Tienda regenerada en ${allRegions.join(
                                    ', '
                                )}.`,
                            },
                            ...st.history,
                        ],
                    };
                });
            },

            // ================= Dinero =================
            addMoney: (amount) => {
                if (!Number.isFinite(amount) || amount === 0) return;
                set((st) => ({
                    undoStack: [snapshotOf(st), ...st.undoStack].slice(
                        0,
                        UNDO_LIMIT
                    ),
                }));
                set((s) => ({
                    money: s.money + amount,
                    history: [
                        {
                            id: crypto.randomUUID(),
                            ts: new Date().toISOString(),
                            type: amount > 0 ? 'money:add' : 'money:subtract',
                            message: `Saldo ${
                                amount > 0 ? '+' : ''
                            }${amount}. Nuevo saldo: ${s.money + amount}`,
                        },
                        ...s.history,
                    ],
                }));
            },

            // ================= Compra =================
            buyAt: (index) => {
                const s = get();
                const cfg = s.cfg;
                if (!cfg) return;

                const slot = s.shop[index];
                if (!slot || slot.__purchased) return;

                if (s.money < slot.precio) {
                    set((st) => ({
                        history: [
                            {
                                id: crypto.randomUUID(),
                                ts: new Date().toISOString(),
                                type: 'buy',
                                message: `Compra fallida de ${slot.nombre}: saldo insuficiente.`,
                            },
                            ...st.history,
                        ],
                    }));
                    return;
                }

                // snapshot para deshacer
                set((st) => ({
                    undoStack: [snapshotOf(st), ...st.undoStack].slice(
                        0,
                        UNDO_LIMIT
                    ),
                }));

                const region = s.regions[s.currentRegionIndex];
                const shopIdx = s.selectedShopIndex;

                // Registrar compra
                const purchase: PurchaseItem = {
                    id: crypto.randomUUID(),
                    ts: new Date().toISOString(),
                    region,
                    pokemonId: slot.id,
                    nombre: slot.nombre,
                    tier: slot.tier,
                    precio: slot.precio,
                };

                // Construir nueva tienda según shopBuyAutofill
                let newShop = s.shop.slice();
                console.log(cfg.shopBuySlotAutofill)
                if (cfg.shopBuySlotAutofill) {
                    // Reglas para buscar candidato del MISMO tier y región
                    const forbidId = slot.id; // evita que salga el mismo inmediatamente
                    const purchasedIds = new Set<number>(
                        s.purchases.map((p) => p.pokemonId)
                    );
                    // Si includePurchasedInRerollPool === false, también excluye el recién comprado
                    if (!cfg.includePurchasedInRerollPool)
                        purchasedIds.add(slot.id);

                    // usedIds: ids visibles en tienda excepto el propio índice que vamos a reemplazar
                    const usedIds = new Set<number>();
                    if (!cfg.allowDuplicates) {
                        s.shop.forEach((p, i) => {
                            if (!p || i === index) return;
                            usedIds.add(p.id);
                        });
                    }

                    const cand = findRerollCandidate(
                        s.data,
                        region,
                        slot.tier as Tier,
                        usedIds,
                        purchasedIds,
                        forbidId,
                        cfg
                    );

                    if (cand) {
                        newShop[index] = { ...cand };
                    } else {
                        // Sin candidato → hueco
                        newShop[index] = {
                            id: -1,
                            nombre: '—',
                            tier: slot.tier,
                            precio: 0,
                            regiones: [region],
                        } as any;
                    }
                } else {
                    // Comportamiento actual: marcar como comprado y dejar el hueco "Comprado"
                    newShop[index] = {
                        ...slot,
                        __purchased: true,
                        __exhausted: false,
                    };
                }

                // Sincronizar el grupo (igual que hacías en reroll/refresh)
                const groupSize = cfg.shopRefreshEveryRegions ?? 1;
                const groupStart =
                    Math.floor(s.currentRegionIndex / groupSize) * groupSize;
                const groupEnd = Math.min(
                    groupStart + groupSize - 1,
                    s.regions.length - 1
                );

                set((st) => {
                    const nextShopByIndex = {
                        ...st.shopByIndex,
                        [shopIdx]: newShop,
                    };
                    for (let i = groupStart; i <= groupEnd; i++) {
                        nextShopByIndex[-(i + 1)] = newShop; // regionKeyFor(i)
                    }
                    return {
                        money: st.money - slot.precio,
                        shop: newShop,
                        shopByIndex: nextShopByIndex,
                        purchases: [purchase, ...st.purchases],
                        history: [
                            {
                                id: crypto.randomUUID(),
                                ts: new Date().toISOString(),
                                type: 'buy',
                                message: `Compra de ${slot.nombre} por ${slot.precio} en ${region}`,
                            },
                            ...st.history,
                        ],
                    };
                });
            },

            // ================= Reroll (global) =================
            rerollAt: (index) => {
                const s = get();
                if (!s.cfg) return;
                const region = s.regions[s.currentRegionIndex];
                const shopIdx = s.selectedShopIndex;
                const used = s.rerollsUsedGlobal;
                const max = s.cfg.rerollsPerRegion;
                if (used >= max) return; // la UI ya desactiva, aquí protegemos
                const slot = s.shop[index];
                if (!slot) return;

                // Ids visibles (evitar duplicados si allowDuplicates=false)
                const usedIds = new Set<number>();
                if (!s.cfg?.allowDuplicates) {
                    for (const x of s.shop) if (x) usedIds.add(x.id);
                }
                const forbidId = slot.id; // no permitir el mismo al rerollear
                const purchasedIds = new Set<number>(
                    s.purchases.map((p) => p.pokemonId)
                );

                const cand = findRerollCandidate(
                    s.data,
                    region,
                    slot.tier as Tier,
                    usedIds,
                    purchasedIds,
                    forbidId,
                    s.cfg
                );
                if (!cand) {
                    // Aviso temporal sin consumir reroll
                    const prev = slot;
                    const newShop = s.shop.slice();
                    newShop[index] = { ...prev, __exhausted: true };
                    set((st) => ({
                        shop: newShop,
                        shopByIndex: { ...st.shopByIndex, [shopIdx]: newShop },
                    }));
                    const key = `${region}:${index}`;
                    const prevTimer = exhaustedTimers.get(key);
                    if (prevTimer) window.clearTimeout(prevTimer);
                    const t = window.setTimeout(() => {
                        const st = get();
                        const activeRegion2 = st.regions[st.currentRegionIndex];
                        if (activeRegion2 !== region) return;
                        const curr = st.shop[index];
                        if (!curr) return;
                        if (curr.__exhausted && curr.id === prev.id) {
                            const revertShop = st.shop.slice();
                            revertShop[index] = { ...prev, __exhausted: false };
                            set({
                                shop: revertShop,
                                shopByIndex: {
                                    ...st.shopByIndex,
                                    [shopIdx]: revertShop,
                                },
                            });
                        }
                        exhaustedTimers.delete(key);
                    }, FLASH_MS);
                    exhaustedTimers.set(key, t);
                    return;
                }

                // Consumir reroll y aplicar
                set((st) => ({
                    undoStack: [snapshotOf(st), ...st.undoStack].slice(
                        0,
                        UNDO_LIMIT
                    ),
                }));
                const newShop = s.shop.slice();
                newShop[index] = { ...cand };
                const groupSize = s.cfg?.shopRefreshEveryRegions ?? 1;
                const groupStart =
                    Math.floor(s.currentRegionIndex / groupSize) * groupSize;
                const groupEnd = Math.min(
                    groupStart + groupSize - 1,
                    s.regions.length - 1
                );
                set((st) => {
                    const nextShopByIndex = {
                        ...st.shopByIndex,
                        [shopIdx]: newShop,
                    };
                    for (let i = groupStart; i <= groupEnd; i++) {
                        nextShopByIndex[regionKeyFor(i)] = newShop;
                    }
                    return {
                        shop: newShop,
                        shopByIndex: nextShopByIndex,
                        rerollsUsedGlobal: used + 1,
                        history: [
                            {
                                id: crypto.randomUUID(),
                                ts: new Date().toISOString(),
                                type: 'reroll',
                                message: `Reroll en ${slot.nombre} → ${
                                    cand.nombre
                                } (Tier ${String(slot.tier).toUpperCase()}).`,
                            },
                            ...st.history,
                        ],
                    };
                });
            },

            // ================= Deshacer =================
            undoLast: () => {
                const s = get();
                const top = s.undoStack[0];
                if (!top) return;
                const rest = s.undoStack.slice(1);
                // Restaurar todo MENOS el historial (debe quedar intacto)
                set((st) => {
                    return {
                        currentRegionIndex: top.currentRegionIndex,
                        selectedRegionIndex: top.selectedRegionIndex,
                        shop: top.shop,
                        shopByIndex: top.shopByIndex,
                        visitedRegions: Array.from(
                            new Set([...(get().visitedRegions || [])])
                        ),
                        rerollsUsedGlobal: top.rerollsUsedGlobal,
                        money: top.money,
                        purchases: top.purchases,
                        undoStack: rest,
                        history: [
                            {
                                id: crypto.randomUUID(),
                                ts: new Date().toISOString(),
                                type: 'undo',
                                message: `Última acción deshecha.`,
                            },
                            ...st.history,
                        ],
                    };
                });
            },

            // ================= Reset =================
            resetAll: async () => {
                try {
                    localStorage.removeItem(STORAGE_KEY);
                } catch {}
                set({
                    cfg: null,
                    data: [],
                    regions: [],
                    currentRegionIndex: 0,
                    selectedRegionIndex: 0,
                    visitedRegions: [],
                    shop: [],
                    shopByIndex: {},
                    rerollsUsedGlobal: 0,
                    money: 0,
                    purchases: [],
                    undoStack: [],
                    history: [
                        {
                            id: crypto.randomUUID(),
                            ts: new Date().toISOString(),
                            type: 'reset',
                            message: 'Datos borrados por el usuario.',
                        },
                    ],
                });
                await get().bootstrap();
            },
        }),
        {
            name: STORAGE_KEY,
            partialize: (s) => ({
                regions: s.regions,
                currentRegionIndex: s.currentRegionIndex,
                selectedRegionIndex: s.selectedRegionIndex,
                visitedRegions: s.visitedRegions,
                shop: s.shop,
                shopByIndex: s.shopByIndex,
                rerollsUsedGlobal: s.rerollsUsedGlobal,
                money: s.money,
                history: s.history,
                purchases: s.purchases,
                undoStack: s.undoStack,
            }),
        }
    )
);
