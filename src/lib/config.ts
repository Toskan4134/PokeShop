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

// Desenvuelve un objeto JSON que puede venir envuelto en un módulo ES6
function unwrapJson<T>(modOrObj: any): T {
    if (modOrObj && typeof modOrObj === 'object' && 'default' in modOrObj) {
        return modOrObj.default as T;
    }
    return modOrObj as T;
}

// Configuración y datos por defecto
export const DEFAULT_CONFIG: AppConfig = unwrapJson<AppConfig>(defaultConfigJson);
export const DEFAULT_POKEMON: Pokemon[] = unwrapJson<Pokemon[]>(defaultPokemonJson);

// Detecta si la aplicación está ejecutándose en Tauri (desktop) o en web
const isTauri = typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

// Combina la configuración personalizada con los valores por defecto
function mergeConfigDefaults(cfg: Partial<AppConfig> | undefined): AppConfig {
    const base = DEFAULT_CONFIG;
    const input = cfg ?? ({} as Partial<AppConfig>);

    return {
        ...base,
        ...input,
        tierColors: { ...(base.tierColors || {}), ...(input.tierColors || {}) },
        tierWeights: { ...(base.tierWeights || {}), ...(input.tierWeights || {}) },
    };
}

// Lee y procesa un archivo de configuración desde disco
async function readAndUnwrapConfigFile(configPath: string, rewrite = false): Promise<AppConfig> {
    try {
        const raw = await readTextFile(configPath);
        let parsed: any;

        try {
            parsed = JSON.parse(raw);
        } catch (parseErr) {
            console.error(`[Config] Error al parsear JSON:`, parseErr);
            return DEFAULT_CONFIG;
        }

        const unwrapped = unwrapJson<AppConfig>(parsed);

        // Si está envuelto en 'default', reescribir el archivo para corregir formato
        if (rewrite && parsed && typeof parsed === 'object' && 'default' in parsed) {
            console.log(`[Config] Corrigiendo formato del archivo de configuración`);
            await writeTextFile(configPath, JSON.stringify(unwrapped, null, 2));
        }

        return mergeConfigDefaults(unwrapped);
    } catch (error) {
        console.error(`[Config] Error al leer configuración:`, error);
        return DEFAULT_CONFIG;
    }
}

// Asegura que existen los archivos de configuración y datos para el perfil actual
export async function ensureConfigFiles(): Promise<{
    configPath: string;
    dataPath: string;
    dir: string;
}> {
    // Preparar estructura de perfiles
    await ensureProfilesStructure();
    await migrateExistingConfig();

    // Obtener directorio del perfil actual
    const currentProfileId = await getCurrentProfile();
    const dir = await getProfileDir(currentProfileId);

    // Crear directorio si no existe
    if (!(await exists(dir))) {
        await mkdir(dir, { recursive: true });
    }

    const configPath = await join(dir, 'config.json');
    const dataPath = await join(dir, DEFAULT_CONFIG.dataFile);

    // Crear archivo de configuración si no existe
    if (!(await exists(configPath))) {
        await writeTextFile(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2));
    } else {
        // Verificar y corregir formato del archivo existente
        try {
            const raw = await readTextFile(configPath);
            const parsed = JSON.parse(raw);

            // Si está envuelto en 'default', corregir formato
            if (parsed && typeof parsed === 'object' && 'default' in parsed) {
                const fixed = unwrapJson<AppConfig>(parsed);
                await writeTextFile(configPath, JSON.stringify(fixed, null, 2));
            }
        } catch (error) {
            console.error(`[Config] Error procesando archivo de configuración:`, error);
        }
    }

    // Crear archivo de datos de pokémon si no existe
    if (!(await exists(dataPath))) {
        await writeTextFile(dataPath, JSON.stringify(DEFAULT_POKEMON, null, 2));
    }

    await ensureSpritesDir();
    return { configPath, dataPath, dir };
}

// Carga la configuración de la aplicación
export async function loadConfig(): Promise<AppConfig> {
    if (!isTauri) {
        // Modo web: intentar cargar desde servidor
        try {
            const res = await fetch('/config.json');
            if (res.ok) {
                const json = await res.json();
                return mergeConfigDefaults(unwrapJson<AppConfig>(json));
            }
            return DEFAULT_CONFIG;
        } catch (error) {
            console.warn(`[Config] Error cargando configuración web:`, error);
            return DEFAULT_CONFIG;
        }
    }

    // Modo Tauri: cargar desde sistema de archivos
    const { configPath } = await ensureConfigFiles();
    return await readAndUnwrapConfigFile(configPath, true);
}

// Carga los datos de pokémon desde el archivo especificado en la configuración
export async function loadPokemonData(cfg: AppConfig): Promise<Pokemon[]> {
    if (!isTauri) {
        // Modo web: intentar cargar desde servidor
        try {
            const res = await fetch('/pokemon.json');
            if (res.ok) {
                const json = await res.json();
                return unwrapJson<Pokemon[]>(json);
            }
            return DEFAULT_POKEMON;
        } catch (error) {
            console.warn(`[Config] Error cargando datos de pokémon web:`, error);
            return DEFAULT_POKEMON;
        }
    }

    // Modo Tauri: cargar desde sistema de archivos
    const { dir } = await ensureConfigFiles();
    const dataPath = await join(dir, cfg.dataFile);

    try {
        const raw = await readTextFile(dataPath);
        const data = JSON.parse(raw) as Pokemon[];
        console.log(`[Config] Cargados ${data.length} pokémon desde: ${cfg.dataFile}`);
        return data;
    } catch (error) {
        console.warn(`[Config] Error cargando datos de pokémon, usando por defecto:`, error);
        return DEFAULT_POKEMON;
    }
}

// Abre la carpeta de configuración del perfil actual
export async function openConfigFolder(): Promise<void> {
    if (!isTauri) return;

    const currentProfileId = await getCurrentProfile();
    const dir = await getProfileDir(currentProfileId);
    await openPath(dir);
}
