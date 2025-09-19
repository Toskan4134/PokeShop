import { appConfigDir, join } from '@tauri-apps/api/path';
import {
    exists,
    mkdir,
    readTextFile,
    writeTextFile,
} from '@tauri-apps/plugin-fs';
import { openPath } from '@tauri-apps/plugin-opener';
import type { AppConfig, Pokemon } from '../types';
import { ensureSpritesDir } from './sprites';

export const DEFAULT_CONFIG: AppConfig = {
    shopSize: 10,
    quota: { S: 1, A: 1, B: 1, C: 2 },
    tierWeights: { C: 40, B: 30, A: 20, S: 10 },
    regionsOrder: ['Kanto', 'Johto'],
    rerollsPerRegion: 2,
    rerollRechargeEveryRegions: 1, // recargar rerolls en cada cambio de región
    shopRefreshEveryRegions: 1, // regenerar tienda en cada cambio de región
    rerollResetOnRefresh: true,
    allowDuplicates: false,
    dataFile: 'pokemon.json',
    tierColors: { S: '#f59e0b', A: '#a855f7', B: '#3b82f6', C: '#22c55e' },
    defaultTierColor: '#9ca3af',
    includePurchasedInRerollPool: false,
    shopBuySlotAutofill: false,
};

export const DEFAULT_POKEMON: Pokemon[] = [
    { id: 1, nombre: 'Bulbasaur', tier: 'C', precio: 200, regiones: ['Kanto'] },
    {
        id: 2,
        nombre: 'Charmander',
        tier: 'C',
        precio: 220,
        regiones: ['Kanto'],
    },
    { id: 3, nombre: 'Squirtle', tier: 'C', precio: 210, regiones: ['Kanto'] },
    { id: 5, nombre: 'Pikachu', tier: 'B', precio: 500, regiones: ['Kanto'] },
    { id: 8, nombre: 'Arcanine', tier: 'A', precio: 1200, regiones: ['Kanto'] },
    { id: 10, nombre: 'Mewtwo', tier: 'S', precio: 5000, regiones: ['Kanto'] },
    {
        id: 101,
        nombre: 'Chikorita',
        tier: 'C',
        precio: 200,
        regiones: ['Johto'],
    },
    { id: 105, nombre: 'Togetic', tier: 'B', precio: 600, regiones: ['Johto'] },
    {
        id: 107,
        nombre: 'Houndoom',
        tier: 'A',
        precio: 1400,
        regiones: ['Johto'],
    },
    {
        id: 108,
        nombre: 'Tyranitar',
        tier: 'S',
        precio: 5200,
        regiones: ['Johto'],
    },
];

const isTauri =
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

function mergeConfigDefaults(cfg: Partial<AppConfig> | undefined): AppConfig {
    const base = DEFAULT_CONFIG;
    const input = cfg ?? ({} as Partial<AppConfig>);
    return {
        ...base,
        ...input,
        tierColors: { ...(base.tierColors || {}), ...(input.tierColors || {}) },
        tierWeights: {
            ...(base.tierWeights || {}),
            ...(input.tierWeights || {}),
        },
    };
}

export async function ensureConfigFiles(): Promise<{
    configPath: string;
    dataPath: string;
    dir: string;
}> {
    const dir = await appConfigDir();
    if (!(await exists(dir))) await mkdir(dir, { recursive: true });
    const configPath = await join(dir, 'config.json');
    const dataPath = await join(dir, DEFAULT_CONFIG.dataFile);
    if (!(await exists(configPath)))
        await writeTextFile(
            configPath,
            JSON.stringify(DEFAULT_CONFIG, null, 2)
        );
    if (!(await exists(dataPath)))
        await writeTextFile(dataPath, JSON.stringify(DEFAULT_POKEMON, null, 2));
    await ensureSpritesDir();
    return { configPath, dataPath, dir };
}

export async function loadConfig(): Promise<AppConfig> {
    if (!isTauri) {
        try {
            const res = await fetch('/config.json');
            return res.ok
                ? mergeConfigDefaults((await res.json()) as AppConfig)
                : DEFAULT_CONFIG;
        } catch {
            return DEFAULT_CONFIG;
        }
    }
    const { configPath } = await ensureConfigFiles();
    const raw = await readTextFile(configPath);
    return mergeConfigDefaults(JSON.parse(raw) as AppConfig);
}

export async function loadPokemonData(cfg: AppConfig): Promise<Pokemon[]> {
    if (!isTauri) {
        try {
            const res = await fetch('/pokemon.json');
            return res.ok ? ((await res.json()) as Pokemon[]) : DEFAULT_POKEMON;
        } catch {
            return DEFAULT_POKEMON;
        }
    }
    const { dir } = await ensureConfigFiles();
    const p = await join(dir, cfg.dataFile);
    const raw = await readTextFile(p);
    return JSON.parse(raw) as Pokemon[];
}

export async function openConfigFolder(): Promise<void> {
    if (!isTauri) return;
    const dir = await appConfigDir();
    await openPath(dir);
}
