// Tipo dinámico para representar tiers: S, A, B, C... Z
export type Tier = string;

// Estructura base de un pokémon
export interface Pokemon {
    id: number; // identificador único
    nombre: string; // nombre del pokémon
    tier: Tier; // clasificación de poder
    precio: number; // costo en la tienda
    regiones: string[]; // regiones donde aparece
}

// Pokémon en la tienda con estados adicionales
export interface ShopPokemon extends Pokemon {
    __purchased?: boolean; // marcado como comprado
    __exhausted?: boolean; // temporalmente agotado (sin candidatos para reroll)
}

// Tipos de eventos en el historial de acciones
export type HistoryEventType =
    | 'money:add' // añadir dinero
    | 'money:subtract' // restar dinero
    | 'buy' // comprar pokémon
    | 'reroll' // rerollear slot
    | 'region:next' // navegar a siguiente región
    | 'region:prev' // navegar a región anterior
    | 'refresh' // actualizar tienda
    | 'reset' // reiniciar todo
    | 'undo'; // deshacer acción

// Entrada del historial de acciones
export interface HistoryEvent {
    id: string; // identificador único
    ts: string; // timestamp ISO
    type: HistoryEventType; // tipo de evento
    message: string; // descripción legible
    meta?: Record<string, unknown>; // metadatos opcionales
}

// Registro de una compra realizada
export interface PurchaseItem {
    id: string; // identificador único
    ts: string; // timestamp de compra
    region: string; // región donde se compró
    pokemonId: number; // ID del pokémon comprado
    nombre: string; // nombre del pokémon
    tier: Tier; // tier del pokémon
    precio: number; // precio pagado
}

// Instantánea del estado para sistema de deshacer
export interface Snapshot {
    currentRegionIndex: number; // índice de región activa
    selectedRegionIndex: number; // índice de región seleccionada
    selectedShopIndex: number; // índice de tienda seleccionada
    shop: ShopPokemon[]; // tienda actual
    shopByIndex: Record<number, ShopPokemon[]>; // tiendas por índice
    rerollsUsedGlobal: number; // rerolls utilizados
    money: number; // dinero actual
    purchases: PurchaseItem[]; // compras realizadas
    history: HistoryEvent[]; // historial (se conserva en undo)
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
