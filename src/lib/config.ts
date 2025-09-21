import { join } from '@tauri-apps/api/path';
import {
    exists,
    mkdir,
    readTextFile,
    writeTextFile,
} from '@tauri-apps/plugin-fs';
import { openPath } from '@tauri-apps/plugin-opener';
import type { AppConfig, Pokemon } from '../types';
import {
    ensureProfilesStructure,
    getCurrentProfile,
    getProfileDir,
    migrateExistingConfig
} from './profileManager';
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
    console.log(`[Config] readAndUnwrapConfigFile called with: ${configPath}, rewrite: ${rewrite}`);
    try {
        const raw = await readTextFile(configPath);
        console.log(`[Config] Read config file content (${raw.length} chars): ${raw.substring(0, 200)}...`);
        let parsed: any;
        try {
            parsed = JSON.parse(raw);
            console.log(`[Config] Parsed config in readAndUnwrapConfigFile:`, parsed);
        } catch (parseErr) {
            console.error(`[Config] JSON parse error in readAndUnwrapConfigFile:`, parseErr);
            // Si el archivo está corrupto, reemplaza por DEFAULT
            return DEFAULT_CONFIG;
        }

        const unwrapped = unwrapJson<AppConfig>(parsed);
        console.log(`[Config] Unwrapped config:`, unwrapped);

        if (
            rewrite &&
            parsed &&
            typeof parsed === 'object' &&
            'default' in parsed
        ) {
            console.log(`[Config] Rewriting config file to fix format`);
            // Repara el archivo sobre disco (opcional)
            await writeTextFile(configPath, JSON.stringify(unwrapped, null, 2));
        }

        const final = mergeConfigDefaults(unwrapped);
        console.log(`[Config] Final merged config:`, final);
        return final;
    } catch (readErr) {
        console.error(`[Config] Error reading config file in readAndUnwrapConfigFile:`, readErr);
        return DEFAULT_CONFIG;
    }
}

export async function ensureConfigFiles(): Promise<{
    configPath: string;
    dataPath: string;
    dir: string;
}> {
    console.log(`[Config] ensureConfigFiles called`);
    await ensureProfilesStructure();
    await migrateExistingConfig();

    const currentProfileId = await getCurrentProfile();
    console.log(`[Config] Current profile ID: ${currentProfileId}`);
    const dir = await getProfileDir(currentProfileId);
    console.log(`[Config] Profile directory: ${dir}`);

    const dirExists = await exists(dir);
    console.log(`[Config] Profile directory exists: ${dirExists}`);
    if (!dirExists) {
        console.log(`[Config] Creating profile directory: ${dir}`);
        await mkdir(dir, { recursive: true });
        console.log(`[Config] Created profile directory successfully`);
    } else {
        console.log(`[Config] Profile directory already exists`);
    }

    const configPath = await join(dir, 'config.json');
    const dataPath = await join(dir, DEFAULT_CONFIG.dataFile);
    console.log(`[Config] Config path: ${configPath}`);
    console.log(`[Config] Data path: ${dataPath}`);

    console.log(`[Config] Checking if config file exists: ${configPath}`);
    const configExists = await exists(configPath);
    console.log(`[Config] Config file exists: ${configExists}`);

    if (!configExists) {
        console.log(`[Config] Creating new config.json at: ${configPath}`);
        await writeTextFile(
            configPath,
            JSON.stringify(DEFAULT_CONFIG, null, 2)
        );
        console.log(`[Config] Created new config.json successfully`);
    } else {
        console.log(`[Config] Config file exists, attempting to read from: ${configPath}`);
        try {
            // Test permissions first
            console.log(`[Config] Testing file access permissions...`);
            const canRead = await exists(configPath).catch(err => {
                console.error(`[Config] Permission test failed:`, err);
                return false;
            });

            if (!canRead) {
                console.error(`[Config] Cannot access config file due to permissions, using default config`);
                return { configPath, dataPath, dir };
            }

            console.log(`[Config] Permission test passed, reading file...`);
            const raw = await readTextFile(configPath);
            console.log(`[Config] Raw config content length: ${raw.length} characters`);
            console.log(`[Config] Raw config content: ${raw}`);
            try {
                const parsed = JSON.parse(raw);
                console.log(`[Config] Parsed config successfully:`, parsed);
                if (parsed && typeof parsed === 'object' && 'default' in parsed) {
                    console.log(`[Config] Fixing config format - removing 'default' wrapper`);
                    const fixed = unwrapJson<AppConfig>(parsed);
                    await writeTextFile(configPath, JSON.stringify(fixed, null, 2));
                    console.log(`[Config] Fixed config format and saved`);
                } else {
                    console.log(`[Config] Config format is already correct`);
                }
            } catch (parseErr) {
                console.error(`[Config] Error parsing config JSON:`, parseErr);
            }
        } catch (readErr) {
            console.error(`[Config] Error reading config file:`, readErr);
            console.log(`[Config] Will use default config due to read error`);
        }
    }

    if (!(await exists(dataPath))) {
        console.log(`[Config] Creating new pokemon data file`);
        await writeTextFile(dataPath, JSON.stringify(DEFAULT_POKEMON, null, 2));
    } else {
        console.log(`[Config] Pokemon data file exists`);
    }

    await ensureSpritesDir();
    return { configPath, dataPath, dir };
}

export async function loadConfig(): Promise<AppConfig> {
    console.log(`[Config] loadConfig called`);
    if (!isTauri) {
        console.log(`[Config] Running in web mode`);
        try {
            const res = await fetch('/config.json');
            if (res.ok) {
                const json = await res.json();
                console.log(`[Config] Loaded config from web`);
                return mergeConfigDefaults(unwrapJson<AppConfig>(json));
            }
            console.log(`[Config] Web config not found, using default`);
            return DEFAULT_CONFIG;
        } catch (err) {
            console.warn(`[Config] Error loading web config:`, err);
            return DEFAULT_CONFIG;
        }
    }
    console.log(`[Config] Running in Tauri mode`);
    const { configPath } = await ensureConfigFiles();
    console.log(`[Config] Loading config from: ${configPath}`);
    const config = await readAndUnwrapConfigFile(configPath, true);
    console.log(`[Config] Loaded config:`, config);
    return config;
}

export async function loadPokemonData(cfg: AppConfig): Promise<Pokemon[]> {
    console.log(`[Config] loadPokemonData called with dataFile: ${cfg.dataFile}`);
    if (!isTauri) {
        console.log(`[Config] Loading pokemon data in web mode`);
        try {
            const res = await fetch('/pokemon.json');
            if (res.ok) {
                const json = await res.json();
                console.log(`[Config] Loaded pokemon data from web`);
                return unwrapJson<Pokemon[]>(json);
            }
            console.log(`[Config] Web pokemon data not found, using default`);
            return DEFAULT_POKEMON;
        } catch (err) {
            console.warn(`[Config] Error loading web pokemon data:`, err);
            return DEFAULT_POKEMON;
        }
    }
    console.log(`[Config] Loading pokemon data in Tauri mode`);
    const { dir } = await ensureConfigFiles();
    const p = await join(dir, cfg.dataFile);
    console.log(`[Config] Pokemon data path: ${p}`);
    try {
        const raw = await readTextFile(p);
        const data = JSON.parse(raw) as Pokemon[];
        console.log(`[Config] Loaded ${data.length} pokemon from: ${p}`);
        return data;
    } catch (err) {
        console.warn(`[Config] Error loading pokemon data, using default:`, err);
        return DEFAULT_POKEMON;
    }
}

export async function openConfigFolder(): Promise<void> {
    if (!isTauri) return;
    const currentProfileId = await getCurrentProfile();
    const dir = await getProfileDir(currentProfileId);
    await openPath(dir);
}
