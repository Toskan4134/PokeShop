import { convertFileSrc } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import { exists, mkdir, writeTextFile } from '@tauri-apps/plugin-fs';
import { openPath } from '@tauri-apps/plugin-opener';
import { getCurrentProfile, getProfileDir } from './profileManager';

export const SPRITES_DIRNAME = 'sprites';

const isTauri =
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

export async function ensureSpritesDir(): Promise<string> {
    console.log(`[Sprites] ensureSpritesDir called`);
    const currentProfileId = await getCurrentProfile();
    console.log(`[Sprites] Current profile ID: ${currentProfileId}`);
    const profileDir = await getProfileDir(currentProfileId);
    const spritesDir = await join(profileDir, SPRITES_DIRNAME);
    console.log(`[Sprites] Sprites directory: ${spritesDir}`);

    try {
        // mkdir puede fallar sin permiso -> si pasa, se ignora (solo lectura)
        await mkdir(spritesDir, { recursive: true });
        console.log(`[Sprites] Created sprites directory`);
    } catch (err) {
        console.warn(`[Sprites] Could not create sprites directory:`, err);
    }

    try {
        const readme = await join(spritesDir, 'LEEME.txt');
        if (!(await exists(readme))) {
            console.log(`[Sprites] Creating README file`);
            await writeTextFile(
                readme,
                [
                    'Pon aquí tus sprites personalizados como PNG llamados por ID:',
                    '1.png, 2.png, 25.png, 001.png (también se acepta).',
                ].join('\n')
            );
        } else {
            console.log(`[Sprites] README file already exists`);
        }
    } catch (err) {
        console.warn(`[Sprites] Could not create README:`, err);
    }

    return spritesDir;
}

/** Abre la carpeta de sprites del usuario */
export async function openSpritesFolder(): Promise<void> {
    if (!isTauri) return;
    const spritesDir = await ensureSpritesDir();
    await openPath(spritesDir);
}

/** URL para <img src>: intenta custom (1.png o 001.png), si no, default; huecos -> empty.png */
export async function resolveSpriteUrl(
    idLike: number | string
): Promise<string> {
    console.log(`[Sprites] resolveSpriteUrl called with: ${idLike}`);
    // Normaliza ID
    const n = Number.parseInt(String(idLike), 10);
    if (!Number.isFinite(n) || n <= 0) {
        console.log(`[Sprites] Invalid ID, using empty sprite`);
        return '/sprites-default/empty.png';
    }

    // Construye candidatos: 1.png y 001.png
    const plain = `${n}.png`;
    const padded = `${String(n).padStart(3, '0')}.png`;
    console.log(`[Sprites] Looking for sprite candidates: ${plain}, ${padded}`);

    // 1) Custom (carpeta de configuración del usuario)
    if (isTauri) {
        try {
            const spritesDir = await ensureSpritesDir();
            console.log(`[Sprites] Checking custom sprites in: ${spritesDir}`);

            for (const name of [plain, padded]) {
                const full = await join(spritesDir, name);
                // 👇 algunos entornos necesitan permiso explícito para exists/read en $APPCONFIG/**
                // si no, lanzará "forbidden path"
                const ok = await exists(full).catch(() => false);
                console.log(`[Sprites] Checking ${full}: ${ok ? 'found' : 'not found'}`);
                if (ok) {
                    // Para mostrar en <img>, convertir a asset://... (requiere assetProtocol.enable + scope)
                    const url = convertFileSrc(full);
                    console.log(`[Sprites] Using custom sprite: ${url}`);
                    return url;
                }
            }
        } catch (err) {
            console.warn(`[Sprites] Error checking custom sprites:`, err);
        }
    }

    // 2) Por defecto (servidos desde /public)
    // probamos 1.png y 001.png por si tus assets por defecto van con padding
    // (el onError de <img> cambiará a missing.png si tampoco existen)
    const defaultUrl = `/sprites-default/${padded}`;
    console.log(`[Sprites] Using default sprite: ${defaultUrl}`);
    return defaultUrl;
}
