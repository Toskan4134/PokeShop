import { create } from 'zustand';
import {
    DEFAULT_CONFIG,
    DEFAULT_POKEMON,
    loadConfig,
    loadPokemonData,
} from '../lib/config';
import { getCurrentProfile } from '../lib/profileManager';
import { buildShopForRegion, findRerollCandidate } from '../lib/storeLogic';
import { loadSaveData, saveSaveData, type SaveData } from '../lib/saveManager';
import type {
    AppConfig,
    HistoryEvent,
    Pokemon,
    PurchaseItem,
    ShopPokemon,
    Snapshot,
    Tier,
} from '../types';

// Configuración interna de la tienda
const UNDO_LIMIT = 20; // máximo de acciones que se pueden deshacer
const FLASH_MS = 2000; // duración del mensaje "No hay pokémon disponibles..."

// Mapa para evitar solapamientos de temporizadores de "slot agotado"
// clave = `${región}:${índice}`
const exhaustedTimers = new Map<string, number>();

// Genera una clave estable para el caché regional dentro de shopByIndex
function regionKeyFor(index: number): number {
    return -(index + 1); // evita colisión con índices de tienda >= 0
}

export type ShopState = {
    // Configuración y datos base
    cfg: AppConfig | null;
    data: Pokemon[];
    regions: string[];

    // Estado de regiones
    currentRegionIndex: number; // región actualmente activa (la que se ve)
    selectedRegionIndex: number; // región seleccionada (no se aplica hasta pulsar Aplicar)
    selectedShopIndex: number; // índice para controlar recarga automática de tienda
    lastShopIndex: number; // índice previo de recarga automática
    visitedRegions: string[]; // regiones ya visitadas (con tienda establecida)

    // Estado de la tienda
    shop: ShopPokemon[]; // tienda visible de la región activa
    shopByIndex: Record<number, ShopPokemon[]>; // tiendas guardadas por índice

    // Estado del juego
    rerollsUsedGlobal: number; // rerolls utilizados (ahora globales)
    money: number; // dinero actual del jugador
    history: HistoryEvent[]; // historial de acciones
    purchases: PurchaseItem[]; // compras realizadas
    undoStack: Snapshot[]; // pila de snapshots para deshacer acciones

    // Acciones disponibles
    bootstrap: () => Promise<void>;
    bootstrapWithProfile: (profileId: string) => Promise<void>;
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
    refreshForProfileSwitch: (oldProfileId?: string, newProfileId?: string) => Promise<void>;
    saveCurrentState: () => Promise<void>;

    // Funciones auxiliares para inicialización
    initializeWithSavedState: (cfg: AppConfig, data: Pokemon[], regions: string[], savedState: SaveData) => Promise<void>;
    initializeFreshState: (cfg: AppConfig, data: Pokemon[], regions: string[]) => Promise<void>;
    initializeFallbackState: () => Promise<void>;
};

// Crea una instantánea del estado actual para poder deshacerla más tarde
function snapshotOf(s: ShopState): Snapshot {
    return {
        currentRegionIndex: s.currentRegionIndex,
        selectedRegionIndex: s.selectedRegionIndex,
        selectedShopIndex: s.selectedShopIndex,
        shop: JSON.parse(JSON.stringify(s.shop)),
        shopByIndex: JSON.parse(JSON.stringify(s.shopByIndex)),
        rerollsUsedGlobal: s.rerollsUsedGlobal,
        money: s.money,
        purchases: JSON.parse(JSON.stringify(s.purchases)),
        history: JSON.parse(JSON.stringify(s.history)),
    };
}

export const useShopStore = create<ShopState>()((set, get) => ({
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

            // ================= Inicialización =================
            bootstrap: async () => {
                console.log(`[Tienda] Iniciando bootstrap`);
                try {
                    // Cargar configuración y datos de pokémon
                    const cfg = await loadConfig();
                    const data = await loadPokemonData(cfg);
                    const regions = cfg.regionsOrder.length ? cfg.regionsOrder : ['Kanto'];

                    console.log(`[Tienda] Cargados ${data.length} pokémon, configurando ${regions.length} regiones`);

                    // Intentar cargar estado guardado del perfil actual
                    const currentProfileId = await getCurrentProfile();
                    const savedState = await loadSaveData();

                    if (savedState) {
                        console.log(`[Tienda] Estado guardado encontrado para perfil: ${currentProfileId}`);
                        await get().initializeWithSavedState(cfg, data, regions, savedState);
                    } else {
                        console.log(`[Tienda] Sin estado guardado, creando tienda nueva`);
                        await get().initializeFreshState(cfg, data, regions);
                    }

                    console.log(`[Tienda] Bootstrap completado exitosamente`);
                } catch (error: any) {
                    console.error(`[Tienda] Error en bootstrap:`, error);
                    await get().initializeFallbackState();
                }
            },

            // ================= Bootstrap with Specific Profile =================
            bootstrapWithProfile: async (profileId: string) => {
                console.log(`[Store] Bootstrap with specific profile started: ${profileId}`);
                try {
                    console.log(`[Store] Loading config...`);
                    const cfg = await loadConfig();
                    console.log(`[Store] Config loaded, loading pokemon data...`);
                    const data = await loadPokemonData(cfg);
                    console.log(`[Store] Loaded ${data.length} pokemon, setting up regions...`);
                    const regions = cfg.regionsOrder.length
                        ? cfg.regionsOrder
                        : ['Kanto'];
                    console.log(`[Store] Regions: ${regions.join(', ')}`);

                    // Load saved state for SPECIFIC profile
                    console.log(`[Store] Loading saved state for specific profile: ${profileId}`);
                    const savedState = await loadSaveData(profileId);
                    if (savedState) {
                        console.log(`[Store] Found saved state for profile: ${profileId}`, savedState);
                    } else {
                        console.log(`[Store] No saved state found for profile: ${profileId}`);
                    }

                    // Use saved state if available, otherwise use defaults
                    let currentRegionIndex = 0;
                    let selectedRegionIndex = 0;
                    let selectedShopIndex = 0;
                    let lastShopIndex = 0;
                    let visitedRegions: string[] = [];
                    let shop: ShopPokemon[] = [];
                    let shopByIndex: Record<number, ShopPokemon[]> = {};
                    let rerollsUsedGlobal = 0;
                    let money = 0;
                    let purchases: PurchaseItem[] = [];
                    let history: HistoryEvent[] = [];
                    let undoStack: Snapshot[] = [];

                    if (savedState) {
                        currentRegionIndex = savedState.currentRegionIndex ?? 0;
                        selectedRegionIndex = savedState.selectedRegionIndex ?? currentRegionIndex;
                        selectedShopIndex = savedState.selectedShopIndex ?? 0;
                        lastShopIndex = savedState.lastShopIndex ?? 0;
                        visitedRegions = savedState.visitedRegions || [];
                        shopByIndex = savedState.shopByIndex || {};
                        rerollsUsedGlobal = savedState.rerollsUsedGlobal ?? 0;
                        money = savedState.money ?? 0;
                        purchases = savedState.purchases || [];
                        history = savedState.history || [];
                        undoStack = savedState.undoStack || [];

                        const persistedIdx = Math.max(0, Math.min(currentRegionIndex, regions.length - 1));
                        const region = regions[persistedIdx];
                        const shopIdx = Math.floor(persistedIdx / (cfg.shopRefreshEveryRegions ?? 1));

                        const rk = regionKeyFor(persistedIdx);
                        const existingRegionShop = shopByIndex[rk];
                        const existingGroupShop = shopByIndex[shopIdx];

                        const purchasedIds = new Set<number>(purchases.map((p) => p.pokemonId));

                        shop = (existingRegionShop && existingRegionShop.length && existingRegionShop) ||
                               (existingGroupShop && existingGroupShop.length && existingGroupShop) ||
                               (buildShopForRegion(data, region, cfg, purchasedIds) as ShopPokemon[]);
                    } else {
                        console.log(`[Store] No saved state, creating fresh shop for profile: ${profileId}`);
                        const region = regions[0];
                        const purchasedIds = new Set<number>();
                        shop = buildShopForRegion(data, region, cfg, purchasedIds) as ShopPokemon[];
                        shopByIndex = { [0]: shop };
                        visitedRegions = [region];
                    }

                    console.log(`[Store] Setting up shop with ${shop.length} items for profile: ${profileId}`);
                    set({
                        cfg,
                        data,
                        regions,
                        currentRegionIndex,
                        selectedRegionIndex,
                        selectedShopIndex,
                        lastShopIndex,
                        visitedRegions,
                        shop,
                        shopByIndex,
                        rerollsUsedGlobal,
                        money,
                        purchases,
                        history,
                        undoStack,
                    });

                    console.log(`[Store] Bootstrap completed for profile: ${profileId}`);
                    // Save state after bootstrap
                    await get().saveCurrentState();
                } catch (err) {
                    console.error(`[Store] Bootstrap error for profile ${profileId}:`, err);
                    // Fallback to fresh state
                    const region = 'Kanto';
                    const shop = [] as ShopPokemon[];
                    set({
                        cfg: DEFAULT_CONFIG,
                        data: DEFAULT_POKEMON,
                        regions: [region],
                        currentRegionIndex: 0,
                        selectedRegionIndex: 0,
                        selectedShopIndex: 0,
                        lastShopIndex: 0,
                        shop,
                        shopByIndex: { [0]: shop },
                        visitedRegions: [region],
                        rerollsUsedGlobal: 0,
                        money: 0,
                        purchases: [],
                        history: [],
                        undoStack: [],
                    });
                    // Save state after bootstrap fallback
                    await get().saveCurrentState();
                }
            },

            // ================= Navegación de Regiones =================
            selectRegionIndex: (i) => {
                const s = get();
                if (!s.cfg) return;
                if (i < 0 || i >= s.regions.length) return;

                set({
                    selectedRegionIndex: i,
                    selectedShopIndex: Math.floor(i / (s.cfg.shopRefreshEveryRegions ?? 1)),
                });
            },

            nextSelectedRegion: () => {
                const s = get();
                if (s.selectedRegionIndex < s.regions.length - 1) {
                    const newIndex = s.selectedRegionIndex + 1;
                    set({
                        selectedRegionIndex: newIndex,
                        selectedShopIndex: Math.floor(newIndex / (s.cfg?.shopRefreshEveryRegions ?? 1)),
                    });
                }
            },

            prevSelectedRegion: () => {
                const s = get();
                if (s.selectedRegionIndex > 0) {
                    const newIndex = s.selectedRegionIndex - 1;
                    set({
                        selectedRegionIndex: newIndex,
                        selectedShopIndex: Math.floor(newIndex / (s.cfg?.shopRefreshEveryRegions ?? 1)),
                    });
                }
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

                // --- Rerolls logic ---
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

                // Save state after applying region
                get().saveCurrentState();
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

                // Save state after refresh
                get().saveCurrentState();
            },

            // ================= Gestión de Dinero =================
            addMoney: (amount) => {
                if (!Number.isFinite(amount) || amount === 0) return;

                // Crear snapshot para poder deshacer
                set((st) => ({
                    undoStack: [snapshotOf(st), ...st.undoStack].slice(0, UNDO_LIMIT),
                }));

                // Actualizar dinero e historial
                set((s) => ({
                    money: s.money + amount,
                    history: [
                        {
                            id: crypto.randomUUID(),
                            ts: new Date().toISOString(),
                            type: amount > 0 ? 'money:add' : 'money:subtract',
                            message: `Saldo ${amount > 0 ? '+' : ''}${amount}. Nuevo saldo: ${s.money + amount}`,
                        },
                        ...s.history,
                    ],
                }));

                get().saveCurrentState();
            },

            // ================= Sistema de Compras =================
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

                // Save state after purchase
                get().saveCurrentState();
            },

            // ================= Sistema de Reroll (Global) =================
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

                // Save state after reroll
                get().saveCurrentState();
            },

            // ================= Sistema de Deshacer =================
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

                // Save state after undo
                get().saveCurrentState();
            },

            // ================= Reinicialización Total =================
            resetAll: async () => {
                try {
                    const { deleteSaveData } = await import('../lib/saveManager');
                    await deleteSaveData();
                } catch (err) {
                    console.warn(`[Tienda] Error borrando archivo de guardado:`, err);
                }

                // Limpiar estado completamente
                set({
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
                    purchases: [],
                    undoStack: [],
                    history: [],
                });

                // Reinicializar con configuración limpia
                await get().bootstrap();

                // Agregar mensaje de reset DESPUÉS del bootstrap para que se preserve
                set((state) => ({
                    history: [
                        {
                            id: crypto.randomUUID(),
                            ts: new Date().toISOString(),
                            type: 'reset' as const,
                            message: 'Datos borrados por el usuario.',
                        },
                        ...state.history,
                    ],
                }));

                // Guardar estado con el mensaje incluido
                await get().saveCurrentState();
            },

            // ================= Cambio de Perfil =================
            refreshForProfileSwitch: async (oldProfileId?: string, newProfileId?: string) => {
                console.log(`[Store] Profile switch refresh started`);

                try {
                    // Guardar estado actual al perfil anterior antes de cambiar
                    if (oldProfileId) {
                        console.log(`[Tienda] Guardando estado actual al perfil anterior: ${oldProfileId}`);
                        const state = get();
                        if (state.cfg) {
                            const stateToSave = {
                                profileId: oldProfileId,
                                regions: state.regions,
                                currentRegionIndex: state.currentRegionIndex,
                                selectedRegionIndex: state.selectedRegionIndex,
                                selectedShopIndex: state.selectedShopIndex,
                                lastShopIndex: state.lastShopIndex,
                                visitedRegions: state.visitedRegions,
                                shop: state.shop,
                                shopByIndex: state.shopByIndex,
                                rerollsUsedGlobal: state.rerollsUsedGlobal,
                                money: state.money,
                                history: state.history,
                                purchases: state.purchases,
                                undoStack: state.undoStack,
                            };
                            // Guardar al perfil anterior con ID específico
                            await saveSaveData(stateToSave, oldProfileId);
                        }
                    } else {
                        console.log(`[Tienda] Sin ID de perfil anterior, guardando al perfil actual`);
                        await get().saveCurrentState();
                    }

                    // Reset state completely for new profile
                    console.log(`[Store] Resetting store state for new profile`);
                    set({
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
                        purchases: [],
                        undoStack: [],
                        history: [],
                    });

                    // Force a small delay to ensure state is cleared
                    console.log(`[Store] Waiting for state reset...`);
                    await new Promise(resolve => setTimeout(resolve, 100));

                    // Bootstrap with new profile's data
                    console.log(`[Store] Bootstrapping with new profile data`);
                    if (newProfileId) {
                        console.log(`[Store] Explicitly loading save data for new profile: ${newProfileId}`);
                        await get().bootstrapWithProfile(newProfileId);
                    } else {
                        await get().bootstrap();
                    }
                    console.log(`[Store] Profile switch completed`);
                } catch (err) {
                    console.error(`[Store] Error during profile switch:`, err);
                    // Fallback: just bootstrap normally
                    await get().bootstrap();
                }
            },

            // ================= Guardar Estado Actual =================
            saveCurrentState: async () => {
                try {
                    const state = get();
                    if (!state.cfg) {
                        console.log(`[Tienda] Sin configuración cargada, omitiendo guardado`);
                        return;
                    }

                    const currentProfileId = await getCurrentProfile();
                    const stateToSave = {
                        profileId: currentProfileId,
                        regions: state.regions,
                        currentRegionIndex: state.currentRegionIndex,
                        selectedRegionIndex: state.selectedRegionIndex,
                        selectedShopIndex: state.selectedShopIndex,
                        lastShopIndex: state.lastShopIndex,
                        visitedRegions: state.visitedRegions,
                        shop: state.shop,
                        shopByIndex: state.shopByIndex,
                        rerollsUsedGlobal: state.rerollsUsedGlobal,
                        money: state.money,
                        history: state.history,
                        purchases: state.purchases,
                        undoStack: state.undoStack,
                    };

                    await saveSaveData(stateToSave);
                } catch (err) {
                    console.error(`[Tienda] Error guardando estado actual:`, err);
                }
            },

            // ================= Funciones Auxiliares de Inicialización =================
            initializeWithSavedState: async (cfg, data, regions, savedState) => {
                const persistedIdx = Math.min(Math.max(0, savedState.currentRegionIndex || 0), regions.length - 1);
                const region = regions[persistedIdx];
                const shopIdx = Math.floor(persistedIdx / (cfg.shopRefreshEveryRegions ?? 1));

                // Reconstruir tienda basada en región actual
                const rk = regionKeyFor(persistedIdx);
                const existingRegionShop = savedState.shopByIndex?.[rk];
                const existingGroupShop = savedState.shopByIndex?.[shopIdx];
                const purchasedIds = new Set<number>((savedState.purchases || []).map((p) => p.pokemonId));

                const shop = (existingRegionShop && existingRegionShop.length && existingRegionShop) ||
                           (existingGroupShop && existingGroupShop.length && existingGroupShop) ||
                           (buildShopForRegion(data, region, cfg, purchasedIds) as ShopPokemon[]);

                set({
                    cfg,
                    data,
                    regions,
                    currentRegionIndex: persistedIdx,
                    selectedRegionIndex: persistedIdx,
                    selectedShopIndex: savedState.selectedShopIndex ?? shopIdx,
                    lastShopIndex: savedState.lastShopIndex ?? 0,
                    shop,
                    shopByIndex: savedState.shopByIndex || {},
                    visitedRegions: savedState.visitedRegions || [region],
                    rerollsUsedGlobal: savedState.rerollsUsedGlobal || 0,
                    money: savedState.money || 0,
                    purchases: savedState.purchases || [],
                    history: savedState.history || [],
                    undoStack: savedState.undoStack || [],
                });

                await get().saveCurrentState();
            },

            initializeFreshState: async (cfg, data, regions) => {
                const region = regions[0];
                const purchasedIds = new Set<number>();
                const shop = buildShopForRegion(data, region, cfg, purchasedIds) as ShopPokemon[];

                set({
                    cfg,
                    data,
                    regions,
                    currentRegionIndex: 0,
                    selectedRegionIndex: 0,
                    selectedShopIndex: 0,
                    lastShopIndex: 0,
                    shop,
                    shopByIndex: { [0]: shop, [regionKeyFor(0)]: shop },
                    visitedRegions: [region],
                    rerollsUsedGlobal: 0,
                    money: 0,
                    purchases: [],
                    history: [],
                    undoStack: [],
                });

                await get().saveCurrentState();
            },

            initializeFallbackState: async () => {
                const cfg = DEFAULT_CONFIG;
                const data = DEFAULT_POKEMON;
                const regions = cfg.regionsOrder.length ? cfg.regionsOrder : ['Kanto'];
                const region = regions[0];
                const purchasedIds = new Set<number>();
                const shop = buildShopForRegion(data, region, cfg, purchasedIds) as ShopPokemon[];

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
                    money: 0,
                    purchases: [],
                    history: [],
                    undoStack: [],
                });

                await get().saveCurrentState();
            },
        }));
