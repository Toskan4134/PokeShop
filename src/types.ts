export type Tier = string; // dinámico: S, A, B, C… Z
export interface Pokemon {
    id: number;
    nombre: string;
    tier: Tier;
    precio: number;
    regiones: string[];
}
export interface ShopPokemon extends Pokemon {
    __purchased?: boolean;
    __exhausted?: boolean;
}

export type HistoryEventType =
    | 'money:add'
    | 'money:subtract'
    | 'buy'
    | 'reroll'
    | 'region:next'
    | 'region:prev'
    | 'refresh'
    | 'reset'
    | 'undo';
export interface HistoryEvent {
    id: string;
    ts: string;
    type: HistoryEventType;
    message: string;
    meta?: Record<string, unknown>;
}

export interface PurchaseItem {
    id: string;
    ts: string;
    region: string;
    pokemonId: number;
    nombre: string;
    tier: Tier;
    precio: number;
}

export interface Snapshot {
    currentRegionIndex: number;
    selectedRegionIndex: number;
    selectedShopIndex: number;
    shop: ShopPokemon[];
    shopByIndex: Record<number, ShopPokemon[]>;
    rerollsUsedGlobal: number;
    money: number;
    purchases: PurchaseItem[];
    history: HistoryEvent[]; // se conserva pero NO se modifica al hacer undo
}

export interface AppConfig {
    shopSize: number;
    quota: Record<string, number>; // ej. { S:2, A:4, B:4 }
    /** Porcentajes por tier (se normalizan). Ej: { C: 40, B: 30, A: 20, S: 10 } */
    tierWeights?: Record<string, number>;

    regionsOrder: string[];
    rerollsPerRegion: number; // máximo de rerolls globales

    // Intervalos:
    // - shopRefreshEveryRegions: cada cuántos CAMBIOS de región se puede regenerar la tienda de UNA región.
    // La tienda de cada región se mantiene igual hasta que hayan pasado N cambios desde su última regeneración.
    // -1 = nunca regenerar por cambio de región (solo manual).
    // - rerollRechargeEveryRegions: recargar rerolls globales tras visitar N REGIONES DISTINTAS (no cuenta volver a una ya visitada dentro del ciclo).
    // -1 = nunca recargar por cambio de región.
    shopRefreshEveryRegions: number; // p.ej. 2 → misma tienda durante 2 cambios de región (por región)
    rerollRechargeEveryRegions: number; // p.ej. 3 → recarga tras 3 regiones NUEVAS distintas

    rerollResetOnRefresh: boolean; // al pulsar Actualizar
    allowDuplicates: boolean;
    dataFile: string; // nombre del JSON de pokémon
    tierColors?: Record<string, string>; // mapa Tier->color CSS
    defaultTierColor?: string; // color por defecto para tiers desconocidos
    includePurchasedInRerollPool?: boolean; // si true, comprados pueden volver a salir en reroll
    shopBuySlotAutofill?: boolean; // Rellenar automáticamente el slot tras comprar (si hay huecos)
}
