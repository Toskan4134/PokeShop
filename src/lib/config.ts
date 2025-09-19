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

import defaultConfigJson from '../data/config.json';
import defaultPokemonJson from '../data/pokemon.json';

function unwrapJson<T>(modOrObj: any): T {
    if (modOrObj && typeof modOrObj === 'object' && 'default' in modOrObj) {
        return modOrObj.default as T;
    }
    return modOrObj as T;
}

export const DEFAULT_CONFIG: AppConfig =
    unwrapJson<AppConfig>(defaultConfigJson);
export const DEFAULT_POKEMON: Pokemon[] =
    unwrapJson<Pokemon[]>(defaultPokemonJson);

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

async function readAndUnwrapConfigFile(
    configPath: string,
    rewrite = false
): Promise<AppConfig> {
    const raw = await readTextFile(configPath);
    let parsed: any;
    try {
        parsed = JSON.parse(raw);
    } catch {
        // Si el archivo está corrupto, reemplaza por DEFAULT
        return DEFAULT_CONFIG;
    }

    const unwrapped = unwrapJson<AppConfig>(parsed);
    if (
        rewrite &&
        parsed &&
        typeof parsed === 'object' &&
        'default' in parsed
    ) {
        // Repara el archivo sobre disco (opcional)
        await writeTextFile(configPath, JSON.stringify(unwrapped, null, 2));
    }
    return mergeConfigDefaults(unwrapped);
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

    if (!(await exists(configPath))) {
        await writeTextFile(
            configPath,
            JSON.stringify(DEFAULT_CONFIG, null, 2)
        );
    } else {
        const raw = await readTextFile(configPath);
        try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && 'default' in parsed) {
                const fixed = unwrapJson<AppConfig>(parsed);
                await writeTextFile(configPath, JSON.stringify(fixed, null, 2));
            }
        } catch {}
    }

    if (!(await exists(dataPath))) {
        await writeTextFile(dataPath, JSON.stringify(DEFAULT_POKEMON, null, 2));
    }

    await ensureSpritesDir();
    return { configPath, dataPath, dir };
}

export async function loadConfig(): Promise<AppConfig> {
    if (!isTauri) {
        try {
            const res = await fetch('/config.json');
            if (res.ok) {
                const json = await res.json();
                return mergeConfigDefaults(unwrapJson<AppConfig>(json));
            }
            return DEFAULT_CONFIG;
        } catch {
            return DEFAULT_CONFIG;
        }
    }
    const { configPath } = await ensureConfigFiles();
    return readAndUnwrapConfigFile(configPath, true);
}

export async function loadPokemonData(cfg: AppConfig): Promise<Pokemon[]> {
    if (!isTauri) {
        try {
            const res = await fetch('/pokemon.json');
            if (res.ok) {
                const json = await res.json();
                return unwrapJson<Pokemon[]>(json);
            }
            return DEFAULT_POKEMON;
        } catch {
            return DEFAULT_POKEMON;
        }
    }
    const { dir } = await ensureConfigFiles();
    const p = await join(dir, cfg.dataFile);
    try {
        const raw = await readTextFile(p);
        return JSON.parse(raw) as Pokemon[];
    } catch {
        return DEFAULT_POKEMON;
    }
}

export async function openConfigFolder(): Promise<void> {
    if (!isTauri) return;
    const dir = await appConfigDir();
    await openPath(dir);
}
